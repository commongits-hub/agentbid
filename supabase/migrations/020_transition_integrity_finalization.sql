-- ============================================================
-- Migration 020: transition integrity finalization
-- Author: commongits-hub
-- 수정 항목:
--   1. hold_reason NULL backfill (migration 016 이전 hold rows 방어)
--   2. prevent_payout_core_change() — system caller bypass 제거 + idempotency
--   3. prevent_order_core_change() — system caller bypass 제거 + idempotency
--   4. unblock_hold_payouts_on_connect() — 별도 advisory lock 상수
--   5. reports INSERT RLS — agent/submission 경유 자기 자신 신고 차단
--
-- 상태 전이표 (DB 기준 공식 버전)
-- ─────────────────────────────────────────────────────────────
-- payouts:
--   pending   → released   (cron: matured + stripe connected)
--   pending   → hold       (cron: matured + stripe not connected)
--   pending   → cancelled  (trg_cancel_payout_on_refund: order refunded)
--   hold      → released   (trg_unblock: onboarding completed + matured)
--   hold      → pending    (trg_unblock: onboarding completed + not matured)
--   released  → transferred (Edge Function: stripe transfer executed)
--   released  → cancelled  (trg_cancel_payout_on_refund: order refunded)
--   transferred → (terminal)
--   cancelled   → (terminal)
--
-- orders:
--   pending          → paid             (webhook: checkout.session.completed)
--   pending          → failed           (webhook: payment_intent.payment_failed)
--   pending          → cancelled        (webhook: checkout.session.expired / cancel)
--   paid             → refund_requested (user: refund request via API)
--   refund_requested → refunded         (webhook: charge.refunded)
--   failed           → (terminal)
--   refunded         → (terminal)
--   cancelled        → (terminal)
-- ─────────────────────────────────────────────────────────────
-- ============================================================

-- ============================================================
-- 1. hold_reason NULL backfill
--    migration 016 이전에 생성된 hold rows는 hold_reason = NULL
--    bi-directional CHECK가 적용된 후에도 기존 데이터 정합성 보장
--    (migration 019가 이미 적용됐으면 no-op, 방어적 실행)
-- ============================================================
UPDATE payouts
  SET hold_reason = 'stripe_not_connected'
  WHERE status = 'hold'
    AND hold_reason IS NULL;

-- ============================================================
-- 2. prevent_payout_core_change() 재정의
--    변경:
--    - system caller bypass 제거 (모든 경로 동일 규칙 적용)
--      이유: 모든 system caller 전이가 이미 allowlist에 포함됨
--      pending→released/hold/cancelled / hold→released/pending / released→transferred/cancelled
--    - idempotency 추가: OLD.status = NEW.status → RETURN NEW (webhook 재처리 안전)
--    - 금융 컬럼 잠금은 role 무관 유지 (기존 동작 유지)
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_payout_core_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- ── 0. 동일 상태 재설정 허용 (idempotency — cron/webhook 재처리 안전) ──────
  IF NEW.status = OLD.status
     AND NEW.hold_reason IS NOT DISTINCT FROM OLD.hold_reason
  THEN
    -- 금융 컬럼 불변 검증은 그대로 진행 (status 동일이어도 금액 조작 차단)
    NULL;
  END IF;

  -- ── 1. 금융 핵심 컬럼: role/caller 무관 불변 ──────────────────────────────
  IF NEW.amount IS DISTINCT FROM OLD.amount THEN
    RAISE EXCEPTION 'Cannot modify payout amount (payout_id: %)', OLD.id USING ERRCODE = '42501';
  END IF;
  IF NEW.agent_id IS DISTINCT FROM OLD.agent_id THEN
    RAISE EXCEPTION 'Cannot modify payout agent_id (payout_id: %)', OLD.id USING ERRCODE = '42501';
  END IF;
  IF NEW.order_id IS DISTINCT FROM OLD.order_id THEN
    RAISE EXCEPTION 'Cannot modify payout order_id (payout_id: %)', OLD.id USING ERRCODE = '42501';
  END IF;
  IF NEW.release_at IS DISTINCT FROM OLD.release_at THEN
    RAISE EXCEPTION 'Cannot modify payout release_at (payout_id: %)', OLD.id USING ERRCODE = '42501';
  END IF;

  -- ── 2. transferred: 종단 상태 — 모든 변경 금지 ─────────────────────────────
  IF OLD.status = 'transferred' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Cannot change payout status after transferred (payout_id: %)',
        OLD.id USING ERRCODE = '42501';
    END IF;
    IF NEW.stripe_transfer_id IS DISTINCT FROM OLD.stripe_transfer_id THEN
      RAISE EXCEPTION 'Cannot change stripe_transfer_id after transferred (payout_id: %)',
        OLD.id USING ERRCODE = '42501';
    END IF;
    IF NEW.transferred_at IS DISTINCT FROM OLD.transferred_at THEN
      RAISE EXCEPTION 'Cannot change transferred_at after transferred (payout_id: %)',
        OLD.id USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- ── 3. cancelled: 종단 상태 ───────────────────────────────────────────────
  IF OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Cannot change payout status from cancelled (payout_id: %)',
      OLD.id USING ERRCODE = '42501';
  END IF;

  -- ── 4. 상태 전이 allowlist (system caller 예외 없음 — 모든 경로 동일 규칙) ─
  --    system caller transitions (release_matured_payouts, cancel_payout_on_refund,
  --    unblock_hold_payouts_on_connect, Edge Function) 모두 아래 allowlist에 포함됨
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'pending'  AND NEW.status IN ('released', 'hold', 'cancelled'))  OR
      (OLD.status = 'hold'     AND NEW.status IN ('released', 'pending'))             OR
      (OLD.status = 'released' AND NEW.status IN ('transferred', 'cancelled'))
    ) THEN
      RAISE EXCEPTION 'Invalid payout status transition: % → % (payout_id: %)',
        OLD.status, NEW.status, OLD.id USING ERRCODE = '42501';
    END IF;
  END IF;

  -- ── 5. hold_reason 정합성 ─────────────────────────────────────────────────
  IF NEW.status = 'hold' AND NEW.hold_reason IS NULL THEN
    RAISE EXCEPTION 'hold_reason must be set when transitioning to hold status (payout_id: %)',
      OLD.id USING ERRCODE = '23514';
  END IF;
  IF NEW.status != 'hold' AND NEW.hold_reason IS NOT NULL THEN
    RAISE EXCEPTION 'hold_reason must be cleared when leaving hold status (payout_id: %, hold_reason: %)',
      OLD.id, NEW.hold_reason USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 3. prevent_order_core_change() 재정의
--    변경:
--    - system caller bypass 제거
--      이유: 모든 webhook/system 전이가 allowlist에 포함됨
--    - idempotency 추가: webhook이 동일 상태로 재처리 시 허용
--      pending→paid 재처리: OLD.paid_at IS NOT NULL이면 skip (already paid)
--    - 금융 컬럼 잠금 유지
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_order_core_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- ── 0. 동일 상태 재설정 허용 (idempotency — webhook 재처리 안전) ───────────
  -- Stripe webhook은 동일 이벤트를 여러 번 전송할 수 있음
  -- 상태 전이 검사는 건너뛰고, 금융 컬럼 불변 검사는 항상 수행
  IF NEW.status != OLD.status THEN
    -- ── 1. 종단 상태: 추가 전이 금지 ─────────────────────────────────────────
    IF OLD.status IN ('failed', 'refunded', 'cancelled') THEN
      RAISE EXCEPTION 'Cannot change order status from terminal state % (order_id: %)',
        OLD.status, OLD.id USING ERRCODE = '42501';
    END IF;

    -- ── 2. 상태 전이 allowlist ──────────────────────────────────────────────
    IF NOT (
      (OLD.status = 'pending'          AND NEW.status IN ('paid', 'failed', 'cancelled'))   OR
      (OLD.status = 'paid'             AND NEW.status = 'refund_requested')                 OR
      (OLD.status = 'refund_requested' AND NEW.status = 'refunded')
    ) THEN
      RAISE EXCEPTION 'Invalid order status transition: % → % (order_id: %)',
        OLD.status, NEW.status, OLD.id USING ERRCODE = '42501';
    END IF;
  END IF;

  -- ── 3. 금융/연결 컬럼 불변 (role/caller/status 무관 — idempotent UPDATE도 포함) ──
  IF NEW.amount IS DISTINCT FROM OLD.amount THEN
    RAISE EXCEPTION 'Cannot modify order amount (order_id: %)', OLD.id USING ERRCODE = '42501';
  END IF;
  IF NEW.platform_fee IS DISTINCT FROM OLD.platform_fee THEN
    RAISE EXCEPTION 'Cannot modify order platform_fee (order_id: %)', OLD.id USING ERRCODE = '42501';
  END IF;
  IF NEW.provider_amount IS DISTINCT FROM OLD.provider_amount THEN
    RAISE EXCEPTION 'Cannot modify order provider_amount (order_id: %)', OLD.id USING ERRCODE = '42501';
  END IF;
  IF NEW.fee_rate_snapshot IS DISTINCT FROM OLD.fee_rate_snapshot THEN
    RAISE EXCEPTION 'Cannot modify order fee_rate_snapshot (order_id: %)', OLD.id USING ERRCODE = '42501';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Cannot modify order user_id (order_id: %)', OLD.id USING ERRCODE = '42501';
  END IF;
  IF NEW.task_id IS DISTINCT FROM OLD.task_id THEN
    RAISE EXCEPTION 'Cannot modify order task_id (order_id: %)', OLD.id USING ERRCODE = '42501';
  END IF;
  IF NEW.submission_id IS DISTINCT FROM OLD.submission_id THEN
    RAISE EXCEPTION 'Cannot modify order submission_id (order_id: %)', OLD.id USING ERRCODE = '42501';
  END IF;
  IF NEW.stripe_checkout_session_id IS DISTINCT FROM OLD.stripe_checkout_session_id THEN
    RAISE EXCEPTION 'Cannot modify order stripe_checkout_session_id (order_id: %)', OLD.id USING ERRCODE = '42501';
  END IF;
  IF NEW.stripe_payment_intent_id IS DISTINCT FROM OLD.stripe_payment_intent_id THEN
    RAISE EXCEPTION 'Cannot modify order stripe_payment_intent_id (order_id: %)', OLD.id USING ERRCODE = '42501';
  END IF;
  -- paid_at: NULL→timestamp 허용 (결제 완료 시 설정), 설정 후 변경 금지
  IF OLD.paid_at IS NOT NULL AND NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
    RAISE EXCEPTION 'Cannot modify order paid_at after payment (order_id: %)', OLD.id USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 4. unblock_hold_payouts_on_connect() — 별도 advisory lock 할당
--    release_matured_payouts: 9182736455000001 (pending → released/hold)
--    unblock_hold_payouts:    9182736455000002 (hold → released/pending)
--    두 함수가 다른 payout 집합(pending vs hold)을 처리하므로 분리
--    단, 같은 payout이 동시에 hold/pending 전이를 시도하면 DB 트리거가 막음
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
  LOCK_KEY CONSTANT bigint := 9182736455000002;
BEGIN
  IF NEW.stripe_onboarding_completed = TRUE
     AND (OLD.stripe_onboarding_completed = FALSE OR OLD.stripe_onboarding_completed IS NULL)
  THEN
    -- advisory lock (unblock 전용)
    IF NOT pg_try_advisory_xact_lock(LOCK_KEY) THEN
      RAISE NOTICE 'unblock_hold_payouts: already running in another session, skipping';
      RETURN NEW;
    END IF;

    -- stripe_account_id 실제 존재 검증 (모순 데이터 방어)
    IF NEW.stripe_account_id IS NULL THEN
      RAISE NOTICE 'unblock_hold_payouts: agent=% has onboarding_completed=TRUE but stripe_account_id IS NULL, skipping',
        NEW.id;
      RETURN NEW;
    END IF;

    -- soft-deleted agent 방어
    IF NEW.soft_deleted_at IS NOT NULL THEN
      RAISE NOTICE 'unblock_hold_payouts: agent=% is soft-deleted, skipping', NEW.id;
      RETURN NEW;
    END IF;

    -- Stripe 연결 사유로 hold된 건만 해제 (다른 hold_reason 보호)
    WITH updated AS (
      UPDATE payouts
      SET
        status      = 'released',
        hold_reason = NULL
      WHERE agent_id      = NEW.id
        AND status        = 'hold'
        AND hold_reason  IN ('stripe_not_connected', 'stripe_not_onboarded')
        AND release_at   <= now()
      RETURNING id
    )
    SELECT count(*) INTO v_released FROM updated;

    WITH updated AS (
      UPDATE payouts
      SET
        status      = 'pending',
        hold_reason = NULL
      WHERE agent_id      = NEW.id
        AND status        = 'hold'
        AND hold_reason  IN ('stripe_not_connected', 'stripe_not_onboarded')
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

DROP TRIGGER IF EXISTS trg_unblock_hold_payouts_on_connect ON agents;
CREATE TRIGGER trg_unblock_hold_payouts_on_connect
  AFTER UPDATE OF stripe_onboarding_completed ON agents
  FOR EACH ROW
  WHEN (
    NEW.stripe_onboarding_completed = TRUE
    AND (OLD.stripe_onboarding_completed IS DISTINCT FROM TRUE)
  )
  EXECUTE FUNCTION unblock_hold_payouts_on_connect();

-- ============================================================
-- 5. reports INSERT RLS — agent/submission 경유 자기 자신 신고 차단
--    target_type='agent': 본인 소유 agent 신고 불가
--    target_type='submission': 본인이 제출한 submission 신고 불가
--    기존: target_type='user' + target_type='task' 차단 유지
-- ============================================================
DROP POLICY IF EXISTS reports_insert ON reports;
CREATE POLICY reports_insert ON reports
  FOR INSERT WITH CHECK (
    -- 신고자 본인
    reporter_id = auth.uid()
    -- target_type='user': 자기 자신 신고 불가
    AND NOT (target_type = 'user' AND target_id = auth.uid())
    -- target_type='agent': 본인 소유 agent 신고 불가
    AND NOT (
      target_type = 'agent'
      AND EXISTS (
        SELECT 1 FROM agents
        WHERE id = target_id
          AND user_id = auth.uid()
          AND soft_deleted_at IS NULL
      )
    )
    -- target_type='task': 본인 소유 task 신고 불가
    AND NOT (
      target_type = 'task'
      AND EXISTS (
        SELECT 1 FROM tasks
        WHERE id = target_id
          AND user_id = auth.uid()
          AND soft_deleted_at IS NULL
      )
    )
    -- target_type='submission': 본인 agent가 제출한 submission 신고 불가
    AND NOT (
      target_type = 'submission'
      AND EXISTS (
        SELECT 1 FROM submissions s
        JOIN agents a ON a.id = s.agent_id
        WHERE s.id = target_id
          AND a.user_id = auth.uid()
      )
    )
  );
