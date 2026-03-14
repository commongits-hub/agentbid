-- ============================================================
-- Migration 021: transition allowlist critical fixes
-- Author: commongits-hub
-- 수정 항목:
--   1. orders: `paid → refunded` 직행 허용
--      (Stripe charge.refunded webhook이 paid 상태에서 직접 refunded로 전환)
--   2. payouts: `hold → cancelled` 허용
--      (환불 시 hold 상태 payout도 취소 필요 — 기존 누락)
--   3. cancel_payout_on_refund() 수정
--      - hold 상태 payout도 cancelled 처리 포함
--      - cancelled 시 hold_reason NULL 초기화
--        (prevent_payout_core_change의 hold_reason 정합성 검증과 충돌 방지)
--
-- 상태 전이표 최종 버전 (코드와 1:1 일치)
-- ──────────────────────────────────────────────────────────────
-- payouts:
--   pending   → released   (cron)
--   pending   → hold       (cron)
--   pending   → cancelled  (trg_cancel_payout_on_refund)
--   hold      → released   (trg_unblock)
--   hold      → pending    (trg_unblock)
--   hold      → cancelled  (trg_cancel_payout_on_refund) [019에서 누락, 본 migration 추가]
--   released  → transferred (Edge Function)
--   released  → cancelled  (trg_cancel_payout_on_refund)
--   transferred → (terminal)
--   cancelled   → (terminal)
--
-- orders:
--   pending          → paid             (webhook: checkout.session.completed)
--   pending          → failed           (webhook: payment_intent.payment_failed)
--   pending          → cancelled        (webhook: checkout.session.expired)
--   paid             → refund_requested (user API)
--   paid             → refunded         (webhook: charge.refunded 직행) [019에서 누락, 본 migration 추가]
--   refund_requested → refunded         (webhook: charge.refunded)
--   failed           → (terminal)
--   refunded         → (terminal)
--   cancelled        → (terminal)
-- ──────────────────────────────────────────────────────────────
-- ============================================================

-- ============================================================
-- 1. prevent_payout_core_change() — hold → cancelled 추가
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_payout_core_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- ── 0. 동일 상태 재설정 허용 (idempotency) ───────────────────────────────
  -- 금융 컬럼 불변 검사는 계속 진행 (이하)
  -- status 전이 검사는 아래에서 status 변경 시에만 수행

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

  -- ── 2. terminal 상태: 추가 변경 금지 ─────────────────────────────────────
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

  IF OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Cannot change payout status from cancelled (payout_id: %)',
      OLD.id USING ERRCODE = '42501';
  END IF;

  -- ── 3. 상태 전이 allowlist (status가 변경될 때만) ─────────────────────────
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'pending'   AND NEW.status IN ('released', 'hold', 'cancelled'))      OR
      (OLD.status = 'hold'      AND NEW.status IN ('released', 'pending', 'cancelled'))   OR  -- hold → cancelled 추가
      (OLD.status = 'released'  AND NEW.status IN ('transferred', 'cancelled'))
    ) THEN
      RAISE EXCEPTION 'Invalid payout status transition: % → % (payout_id: %)',
        OLD.status, NEW.status, OLD.id USING ERRCODE = '42501';
    END IF;
  END IF;

  -- ── 4. hold_reason 정합성 ─────────────────────────────────────────────────
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
-- 2. cancel_payout_on_refund() 수정
--    - hold 상태 payout도 cancelled 처리 (기존 누락)
--    - hold_reason = NULL 초기화 (prevent_payout_core_change 정합성 요구)
--    - transferred 취소 불가 유지
-- ============================================================
CREATE OR REPLACE FUNCTION cancel_payout_on_refund()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'refunded' AND OLD.status != 'refunded' THEN
    -- pending / released → cancelled
    UPDATE payouts
    SET
      status      = 'cancelled',
      hold_reason = NULL        -- NULL 아닌 경우 방어 (실제로는 NULL이어야 함)
    WHERE order_id = NEW.id
      AND status IN ('pending', 'released');

    -- hold → cancelled (환불 시 hold payout도 정리)
    -- hold_reason 반드시 NULL로 초기화 (prevent_payout_core_change 요구사항)
    UPDATE payouts
    SET
      status      = 'cancelled',
      hold_reason = NULL
    WHERE order_id = NEW.id
      AND status = 'hold';

    -- transferred: 취소 불가 (이미 출금됨 — 별도 회수 프로세스 필요)
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 3. prevent_order_core_change() — paid → refunded 직행 허용
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_order_core_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- ── 0. 동일 상태 재설정 허용 (idempotency — webhook 재처리 안전) ───────────
  IF NEW.status != OLD.status THEN

    -- ── 1. 종단 상태: 추가 전이 금지 ─────────────────────────────────────────
    IF OLD.status IN ('failed', 'refunded', 'cancelled') THEN
      RAISE EXCEPTION 'Cannot change order status from terminal state % (order_id: %)',
        OLD.status, OLD.id USING ERRCODE = '42501';
    END IF;

    -- ── 2. 상태 전이 allowlist ──────────────────────────────────────────────
    IF NOT (
      (OLD.status = 'pending'          AND NEW.status IN ('paid', 'failed', 'cancelled'))   OR
      (OLD.status = 'paid'             AND NEW.status IN ('refund_requested', 'refunded'))  OR  -- paid → refunded 직행 추가
      (OLD.status = 'refund_requested' AND NEW.status = 'refunded')
    ) THEN
      RAISE EXCEPTION 'Invalid order status transition: % → % (order_id: %)',
        OLD.status, NEW.status, OLD.id USING ERRCODE = '42501';
    END IF;

  END IF;

  -- ── 3. 금융/연결 컬럼 불변 (idempotent update 포함) ──────────────────────
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
  IF OLD.paid_at IS NOT NULL AND NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
    RAISE EXCEPTION 'Cannot modify order paid_at after payment (order_id: %)', OLD.id USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- advisory lock 분리 근거 주석
-- release_matured_payouts  (9182736455000001): 대상 = pending payouts
-- unblock_hold_payouts     (9182736455000002): 대상 = hold payouts
-- 두 함수는 status='pending' vs status='hold'로 서로 다른 row set을 처리하므로
-- 동일 payout row에 동시 접근이 원천적으로 불가능
-- → 별도 advisory lock은 각 함수의 자기 중복 실행(cron 겹침) 방지용
-- → 함수 간 경합은 PostgreSQL row-level locking(UPDATE는 FOR UPDATE)으로 처리됨
-- ============================================================
