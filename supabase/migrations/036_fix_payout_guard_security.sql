-- ============================================================
-- Migration 036: 009_payout_guard 보강
--   1) release_matured_payouts() / unblock_hold_payouts_on_connect()
--      SECURITY DEFINER + SET search_path = public + public. qualification
--   2) unblock_hold_payouts_on_connect()
--      stripe_account_id IS NOT NULL 가드 추가
--   3) release_matured_payouts()
--      soft_deleted agent payout → hold로 전환 (pending 방치 방지)
--   4) COMMENT 오타 수정 (daily cron(002*) → daily cron 02:00 UTC)
-- ============================================================

-- ------------------------------------------------------------
-- [1][3][4] release_matured_payouts()
--   SECURITY DEFINER + search_path + public. qualification
--   soft_deleted agent payout → hold (B안 확정)
--     - soft_deleted agent의 payout을 pending에 방치하면 해석 불명확
--     - hold 전환으로 "자동 정산 대상 외, 수동 처리 필요" 상태 명시
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION release_matured_payouts()
RETURNS void AS $$
DECLARE
  v_released        integer := 0;
  v_held            integer := 0;
  v_held_deleted    integer := 0;
BEGIN
  -- Case A: pending + 만기 + Stripe 연결 완료 + soft_deleted 아님 → released
  WITH updated AS (
    UPDATE public.payouts p
    SET status = 'released'
    FROM public.agents a
    WHERE p.agent_id                      = a.id
      AND p.status                        = 'pending'
      AND p.release_at                   <= now()
      AND a.stripe_onboarding_completed   = TRUE
      AND a.soft_deleted_at               IS NULL
    RETURNING p.id
  )
  SELECT count(*) INTO v_released FROM updated;

  -- Case B: pending + 만기 + Stripe 미연결 (또는 account 없음) + soft_deleted 아님 → hold
  WITH updated AS (
    UPDATE public.payouts p
    SET status = 'hold'
    FROM public.agents a
    WHERE p.agent_id   = a.id
      AND p.status     = 'pending'
      AND p.release_at <= now()
      AND (
        a.stripe_onboarding_completed = FALSE
        OR a.stripe_account_id IS NULL
      )
      AND a.soft_deleted_at IS NULL
    RETURNING p.id
  )
  SELECT count(*) INTO v_held FROM updated;

  -- Case C: pending + 만기 + soft_deleted agent → hold (수동 처리 대상)
  --   soft_deleted agent의 payout을 pending에 방치하면 자동 정산 대상인지 불명확
  --   hold로 보내서 "자동 정산 외, 수동 검토 필요" 상태로 명시
  WITH updated AS (
    UPDATE public.payouts p
    SET    status = 'hold'
    FROM   public.agents a
    WHERE  p.agent_id   = a.id
      AND  p.status     = 'pending'
      AND  p.release_at <= now()
      AND  a.soft_deleted_at IS NOT NULL
    RETURNING p.id
  )
  SELECT count(*) INTO v_held_deleted FROM updated;

  RAISE NOTICE 'release_matured_payouts: released=%, held=%, held_deleted_agent=%',
    v_released, v_held, v_held_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION release_matured_payouts() IS
  'daily cron 02:00 UTC: pending payout 만기 처리. '
  'Stripe 연결 완료 → released, 미연결/soft_deleted agent → hold. '
  '참조: 007_storage_and_cron(cron 등록), 034(idempotency 보강).';

-- ------------------------------------------------------------
-- [1][2] unblock_hold_payouts_on_connect()
--   SECURITY DEFINER + search_path + public. qualification
--   stripe_account_id IS NOT NULL 가드 추가
--     - onboarding_completed=TRUE여도 account_id 없으면 transfer 불가
--     - 데이터 불일치/수동 수정 케이스 방어
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION unblock_hold_payouts_on_connect()
RETURNS TRIGGER AS $$
DECLARE
  v_released integer := 0;
  v_restored integer := 0;
BEGIN
  -- stripe_onboarding_completed: FALSE → TRUE 전환 시에만 동작
  -- AND stripe_account_id IS NOT NULL: account_id 없으면 transfer 불가이므로 hold 유지
  IF NEW.stripe_onboarding_completed = TRUE
     AND (OLD.stripe_onboarding_completed = FALSE OR OLD.stripe_onboarding_completed IS NULL)
     AND NEW.stripe_account_id IS NOT NULL
  THEN
    -- hold 중 이미 release_at 경과 → released
    WITH updated AS (
      UPDATE public.payouts
      SET status = 'released'
      WHERE agent_id  = NEW.id
        AND status    = 'hold'
        AND release_at <= now()
      RETURNING id
    )
    SELECT count(*) INTO v_released FROM updated;

    -- hold 중 아직 release_at 미경과 → pending 복귀
    WITH updated AS (
      UPDATE public.payouts
      SET status = 'pending'
      WHERE agent_id  = NEW.id
        AND status    = 'hold'
        AND release_at > now()
      RETURNING id
    )
    SELECT count(*) INTO v_restored FROM updated;

    RAISE NOTICE 'unblock_hold_payouts: agent=%, released=%, pending_restored=%',
      NEW.id, v_released, v_restored;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION unblock_hold_payouts_on_connect() IS
  'agents.stripe_onboarding_completed TRUE 전환 시 hold payout 자동 해제. '
  '조건: onboarding_completed=TRUE AND stripe_account_id IS NOT NULL. '
  'account_id 없는 경우 hold 유지 (transfer 불가 방어).';
