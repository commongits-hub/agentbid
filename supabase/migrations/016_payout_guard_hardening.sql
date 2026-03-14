-- ============================================================
-- Migration 016: payout guard hardening
-- Author: commongits-hub
-- 수정 항목:
--   1. payouts.hold_reason 컬럼 추가 (hold 사유 추적)
--   2. release_matured_payouts()
--      - SECURITY DEFINER + SET search_path 고정
--      - Case A: stripe_account_id IS NOT NULL 명시적 추가
--      - Case B: hold_reason 기록
--      - 동시 실행 방지: pg_try_advisory_xact_lock
--   3. unblock_hold_payouts_on_connect()
--      - SECURITY DEFINER + SET search_path 고정
--      - stripe_account_id IS NOT NULL 검증 추가
--      - soft_deleted_at IS NULL 검증 추가
--      - hold_reason = 'stripe_not_connected' row만 해제 (다른 사유 보호)
--   4. 트리거 WHEN 절 추가
-- ============================================================

-- ============================================================
-- 1. payouts.hold_reason 컬럼 추가
--    hold된 이유를 추적 — 향후 다른 hold 사유 추가 시 구분 가능
--    null: hold 아닌 상태 (pending/released/transferred/cancelled)
-- ============================================================
ALTER TABLE payouts
  ADD COLUMN IF NOT EXISTS hold_reason text;

COMMENT ON COLUMN payouts.hold_reason IS
  '정산 보류 사유. hold 상태일 때만 의미있음. '
  'stripe_not_connected: stripe_account_id 없음 또는 onboarding 미완료. '
  'admin_hold: 관리자 수동 보류 (향후). '
  'null: hold 아닌 상태';

-- ============================================================
-- 2. release_matured_payouts() 재정의
-- ============================================================
CREATE OR REPLACE FUNCTION release_matured_payouts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_released integer := 0;
  v_held     integer := 0;
BEGIN
  -- ── 동시 실행 방지 ─────────────────────────────────────────
  -- pg_try_advisory_xact_lock: 트랜잭션 레벨 advisory lock
  -- 다른 세션에서 같은 lock을 잡고 있으면 즉시 false 반환
  IF NOT pg_try_advisory_xact_lock(hashtext('release_matured_payouts')) THEN
    RAISE NOTICE 'release_matured_payouts: already running in another session, skipping';
    RETURN;
  END IF;

  -- ── Case A: pending + 만기 + Stripe 연결 완료 → released ──
  -- 조건: onboarding_completed=TRUE AND stripe_account_id IS NOT NULL
  -- (모순 데이터: onboarding=TRUE + account_id=NULL 방지 — 두 조건 모두 명시)
  WITH updated AS (
    UPDATE payouts p
    SET
      status      = 'released',
      hold_reason = NULL
    FROM agents a
    WHERE p.agent_id                      = a.id
      AND p.status                        = 'pending'
      AND p.release_at                   <= now()
      AND a.stripe_onboarding_completed   = TRUE
      AND a.stripe_account_id            IS NOT NULL   -- 명시적 추가 (모순 데이터 방어)
      AND a.soft_deleted_at              IS NULL
    RETURNING p.id
  )
  SELECT count(*) INTO v_released FROM updated;

  -- ── Case B: pending + 만기 + Stripe 미연결 → hold ─────────
  -- hold_reason에 사유 기록 (향후 다른 hold 사유와 구분 가능)
  WITH updated AS (
    UPDATE payouts p
    SET
      status      = 'hold',
      hold_reason = CASE
        WHEN a.stripe_account_id IS NULL THEN 'stripe_not_connected'
        ELSE 'stripe_not_verified'  -- account_id 있지만 onboarding 미완료
      END
    FROM agents a
    WHERE p.agent_id                    = a.id
      AND p.status                      = 'pending'
      AND p.release_at                 <= now()
      AND (
        a.stripe_onboarding_completed   = FALSE
        OR a.stripe_account_id         IS NULL
      )
      AND a.soft_deleted_at            IS NULL
    RETURNING p.id
  )
  SELECT count(*) INTO v_held FROM updated;

  RAISE NOTICE 'release_matured_payouts: released=%, held=%', v_released, v_held;
END;
$$;

COMMENT ON FUNCTION release_matured_payouts() IS
  'cron 0 2 * * * UTC: pending payout 만기 처리. '
  'Stripe 연결 완료(onboarding=TRUE + account_id IS NOT NULL) → released, '
  '미연결 → hold (hold_reason 기록). '
  '동시 실행 방지: pg_try_advisory_xact_lock.';

-- ============================================================
-- 3. unblock_hold_payouts_on_connect() 재정의
-- ============================================================
CREATE OR REPLACE FUNCTION unblock_hold_payouts_on_connect()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_released integer := 0;
  v_restored integer := 0;
BEGIN
  -- stripe_onboarding_completed: FALSE → TRUE 전환 시에만 동작
  IF NEW.stripe_onboarding_completed = TRUE
     AND (OLD.stripe_onboarding_completed = FALSE OR OLD.stripe_onboarding_completed IS NULL)
  THEN
    -- ── 추가 안전 조건 ─────────────────────────────────────
    -- stripe_account_id가 실제로 설정돼 있어야 hold 해제 허용
    -- (onboarding_completed=TRUE + account_id=NULL 모순 데이터 방어)
    IF NEW.stripe_account_id IS NULL THEN
      RAISE NOTICE 'unblock_hold_payouts: agent=% has onboarding_completed=TRUE but stripe_account_id IS NULL, skipping',
        NEW.id;
      RETURN NEW;
    END IF;

    -- soft_deleted agent는 해제하지 않음
    IF NEW.soft_deleted_at IS NOT NULL THEN
      RAISE NOTICE 'unblock_hold_payouts: agent=% is soft-deleted, skipping', NEW.id;
      RETURN NEW;
    END IF;

    -- Stripe 미연결 사유로 hold된 건만 해제 (다른 hold_reason 보호)
    -- hold_reason IN ('stripe_not_connected', 'stripe_not_verified') 만 대상

    -- 만기 경과 → released
    WITH updated AS (
      UPDATE payouts
      SET
        status      = 'released',
        hold_reason = NULL
      WHERE agent_id      = NEW.id
        AND status        = 'hold'
        AND hold_reason  IN ('stripe_not_connected', 'stripe_not_verified')
        AND release_at   <= now()
      RETURNING id
    )
    SELECT count(*) INTO v_released FROM updated;

    -- 만기 미경과 → pending 복귀
    WITH updated AS (
      UPDATE payouts
      SET
        status      = 'pending',
        hold_reason = NULL
      WHERE agent_id      = NEW.id
        AND status        = 'hold'
        AND hold_reason  IN ('stripe_not_connected', 'stripe_not_verified')
        AND release_at    > now()
      RETURNING id
    )
    SELECT count(*) INTO v_restored FROM updated;

    RAISE NOTICE 'unblock_hold_payouts: agent=%, released=%, pending_restored=%',
      NEW.id, v_released, v_restored;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION unblock_hold_payouts_on_connect() IS
  'agents.stripe_onboarding_completed TRUE 전환 시 stripe 사유 hold payout 자동 해제. '
  'stripe_account_id IS NULL인 경우 해제 안 함. '
  'hold_reason이 stripe 사유인 row만 대상.';

-- ============================================================
-- 4. 트리거 재생성 — WHEN 절 추가 (비필요 실행 최소화)
-- ============================================================
DROP TRIGGER IF EXISTS trg_unblock_hold_payouts_on_connect ON agents;

CREATE TRIGGER trg_unblock_hold_payouts_on_connect
  AFTER UPDATE OF stripe_onboarding_completed ON agents
  FOR EACH ROW
  -- WHEN 절: FALSE/NULL → TRUE 전환 시에만 실행
  WHEN (
    NEW.stripe_onboarding_completed = TRUE
    AND (OLD.stripe_onboarding_completed IS DISTINCT FROM TRUE)
  )
  EXECUTE FUNCTION unblock_hold_payouts_on_connect();

-- ============================================================
-- 5. 인덱스 보완
--    hold 해제 함수가 agent_id + release_at + hold_reason 조건 사용
--    기존 idx_payouts_hold_agent(agent_id)에 release_at 추가
-- ============================================================
DROP INDEX IF EXISTS idx_payouts_hold_agent;
CREATE INDEX idx_payouts_hold_agent
  ON payouts (agent_id, release_at)
  WHERE status = 'hold';
