-- ============================================================
-- Migration 009: payout_guard
-- Author: commongits-hub
-- Description:
--   정산 실행 전 Stripe Connect 연결 여부를 SQL 레벨에서 강제 검증
--
--   핵심 변경:
--   1. release_matured_payouts() 재정의
--      - 연결 완료(stripe_onboarding_completed = TRUE): pending → released
--      - 미연결(stripe_onboarding_completed = FALSE): pending → hold
--   2. trg_unblock_hold_payouts_on_connect 추가
--      - agents.stripe_onboarding_completed FALSE→TRUE 전환 시
--        해당 agent의 hold payouts 자동 재분류
--        · release_at <= now() → released (즉시 정산 가능)
--        · release_at >  now() → pending  (대기 기간 복귀)
--   3. 보조 인덱스 추가
-- ============================================================

-- ============================================================
-- 1. release_matured_payouts() 재정의
--    기존 함수 교체 (OR REPLACE)
-- ============================================================
CREATE OR REPLACE FUNCTION release_matured_payouts()
RETURNS void AS $$
DECLARE
  v_released integer := 0;
  v_held     integer := 0;
BEGIN
  -- Case A: pending + 만기 + Stripe 연결 완료 → released
  WITH updated AS (
    UPDATE payouts p
    SET status = 'released'
    FROM agents a
    WHERE p.agent_id              = a.id
      AND p.status                = 'pending'
      AND p.release_at            <= now()
      AND a.stripe_onboarding_completed = TRUE
      AND a.soft_deleted_at       IS NULL
    RETURNING p.id
  )
  SELECT count(*) INTO v_released FROM updated;

  -- Case B: pending + 만기 + Stripe 미연결 (또는 account 없음) → hold
  --   · stripe_onboarding_completed = FALSE  (온보딩 미완료)
  --   · stripe_account_id IS NULL           (계좌 생성도 안 된 경우)
  --   둘 중 하나라도 해당되면 hold 처리
  WITH updated AS (
    UPDATE payouts p
    SET status = 'hold'
    FROM agents a
    WHERE p.agent_id              = a.id
      AND p.status                = 'pending'
      AND p.release_at            <= now()
      AND (
        a.stripe_onboarding_completed = FALSE
        OR a.stripe_account_id IS NULL
      )
      AND a.soft_deleted_at IS NULL
    RETURNING p.id
  )
  SELECT count(*) INTO v_held FROM updated;

  -- 결과 로깅 (pg_cron 로그에서 확인 가능)
  RAISE NOTICE 'release_matured_payouts: released=%, held=%', v_released, v_held;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION release_matured_payouts() IS
  'daily cron(002*): pending payout 만기 처리. '
  'Stripe 연결 완료 → released, 미연결 → hold';

-- ============================================================
-- 2. hold 해제 함수: 온보딩 완료 시 hold payouts 재분류
--    · release_at <= now() → released  (즉시 정산 가능)
--    · release_at >  now() → pending   (대기 기간 복귀)
-- ============================================================
CREATE OR REPLACE FUNCTION unblock_hold_payouts_on_connect()
RETURNS TRIGGER AS $$
DECLARE
  v_released integer := 0;
  v_restored integer := 0;
BEGIN
  -- stripe_onboarding_completed: FALSE → TRUE 전환 시에만 동작
  IF NEW.stripe_onboarding_completed = TRUE
     AND (OLD.stripe_onboarding_completed = FALSE OR OLD.stripe_onboarding_completed IS NULL)
  THEN
    -- hold 중 이미 release_at 경과 → released
    WITH updated AS (
      UPDATE payouts
      SET status = 'released'
      WHERE agent_id  = NEW.id
        AND status    = 'hold'
        AND release_at <= now()
      RETURNING id
    )
    SELECT count(*) INTO v_released FROM updated;

    -- hold 중 아직 release_at 미경과 → pending 복귀
    WITH updated AS (
      UPDATE payouts
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
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION unblock_hold_payouts_on_connect() IS
  'agents.stripe_onboarding_completed TRUE 전환 시 hold payout 자동 해제';

-- 기존 트리거 있으면 교체 (재실행 안전)
DROP TRIGGER IF EXISTS trg_unblock_hold_payouts_on_connect ON agents;

CREATE TRIGGER trg_unblock_hold_payouts_on_connect
  AFTER UPDATE OF stripe_onboarding_completed ON agents
  FOR EACH ROW
  EXECUTE FUNCTION unblock_hold_payouts_on_connect();

-- ============================================================
-- 3. 보조 인덱스
-- ============================================================

-- cron이 매일 조회하는 pending+만기 payout (agents 조인 포함)
-- release_at 기준 부분 인덱스 (pending만)
-- ※ 기존 idx_payouts_release_pending (004에서 생성)과 별개 — 조인 컬럼 추가
CREATE INDEX IF NOT EXISTS idx_payouts_pending_release_agent
  ON payouts (agent_id, release_at)
  WHERE status = 'pending';

-- hold 상태 payout — 온보딩 완료 시 즉시 조회
CREATE INDEX IF NOT EXISTS idx_payouts_hold_agent
  ON payouts (agent_id)
  WHERE status = 'hold';

-- ============================================================
-- 4. 상태 전이 요약 (주석)
-- ============================================================
--
--  pending ──[만기 + connected]──→ released ──[Edge Fn]──→ transferred
--     │
--     └──[만기 + NOT connected]──→ hold
--                                    │
--                  [온보딩 완료, 만기 이미 경과]──→ released
--                  [온보딩 완료, 만기 미경과  ]──→ pending
--
--  cancelled: order refunded 시 (trg_cancel_payout_on_refund, 004)
--             → transferred 상태는 취소 불가 (환불 불가 정책)
--
-- ============================================================
-- 검증 쿼리 (배포 후 실행)
-- ============================================================
--
-- 1. 함수 정의 확인
-- SELECT proname, prosrc FROM pg_proc WHERE proname IN (
--   'release_matured_payouts', 'unblock_hold_payouts_on_connect'
-- );
--
-- 2. 트리거 확인
-- SELECT trigger_name, event_object_table, action_timing, event_manipulation
-- FROM information_schema.triggers
-- WHERE trigger_schema = 'public'
--   AND trigger_name = 'trg_unblock_hold_payouts_on_connect';
--
-- 3. 인덱스 확인
-- SELECT indexname FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND indexname IN (
--     'idx_payouts_pending_release_agent',
--     'idx_payouts_hold_agent'
--   );
--
-- 4. 미연결 provider payout hold 시뮬레이션
-- -- (test agent id = '<uuid>')
-- UPDATE agents SET stripe_onboarding_completed = FALSE WHERE id = '<uuid>';
-- UPDATE payouts SET release_at = now() - INTERVAL '1 minute'
--   WHERE agent_id = '<uuid>' AND status = 'pending';
-- SELECT release_matured_payouts();
-- SELECT status FROM payouts WHERE agent_id = '<uuid>';
-- -- 기대: hold
--
-- 5. 온보딩 완료 시 hold 해제 시뮬레이션
-- UPDATE agents SET stripe_onboarding_completed = TRUE WHERE id = '<uuid>';
-- SELECT status FROM payouts WHERE agent_id = '<uuid>';
-- -- 기대: released (release_at 경과 케이스)
