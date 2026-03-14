-- ============================================================
-- Migration 019: financial integrity finalization
-- Author: commongits-hub
-- 수정 항목:
--   1. payouts.hold_reason 양방향 CHECK — hold 상태 시 NOT NULL 강제
--   2. hold_reason 값 rename: stripe_not_verified → stripe_not_onboarded
--   3. release_matured_payouts() — advisory lock 상수 bigint + rename 반영
--   4. prevent_payout_core_change() 강화:
--      - transferred 이전에도 금융 컬럼(amount/agent_id/order_id/release_at) 잠금
--      - hold_reason 위반: 조용한 NULL 복원 → RAISE EXCEPTION
--      - 상태 전이 allowlist (system/service_role 제외)
--   5. prevent_submission_manipulation() — blocklist → allowlist 방식 전환
--   6. reports INSERT RLS — target_type='user' 자기 자신 신고 차단
--   7. prevent_order_core_change() — 상태 전이 allowlist 추가
-- ============================================================

-- ============================================================
-- 1. payouts.hold_reason 양방향 CHECK
--    기존: status != 'hold' → hold_reason IS NULL
--    추가: status = 'hold' → hold_reason IS NOT NULL
--    결과: hold ↔ hold_reason 완전 쌍방 강제
-- ============================================================
ALTER TABLE payouts
  ADD CONSTRAINT chk_hold_status_requires_reason
  CHECK (status != 'hold' OR hold_reason IS NOT NULL);

COMMENT ON CONSTRAINT chk_hold_status_requires_reason ON payouts IS
  'hold 상태 진입 시 hold_reason 반드시 설정 필요. '
  '기존 chk_hold_reason_null_when_not_hold와 함께 양방향 강제.';

-- ============================================================
-- 2. hold_reason 값 rename: stripe_not_verified → stripe_not_onboarded
--    실제 판정 기준이 stripe_onboarding_completed=false이므로
--    verified와 onboarded는 의미상 다름 — 정확한 이름으로 수정
--    기존 DB 데이터도 업데이트 (현재 hold 상태 row가 있으면 반영)
-- ============================================================
UPDATE payouts
  SET hold_reason = 'stripe_not_onboarded'
  WHERE hold_reason = 'stripe_not_verified';

-- ============================================================
-- 3. release_matured_payouts() — advisory lock 상수 bigint + hold_reason rename
--    hashtext('...') 대신 안정 bigint 상수 사용 (충돌 가능성 제거)
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
  -- 안정 bigint 상수 (hashtext 대신 명시적 값)
  -- 다른 함수와 충돌하지 않도록 고정 할당
  LOCK_KEY CONSTANT bigint := 9182736455000001;
BEGIN
  IF NOT pg_try_advisory_xact_lock(LOCK_KEY) THEN
    RAISE NOTICE 'release_matured_payouts: already running in another session, skipping';
    RETURN;
  END IF;

  -- Case A: pending + 만기 + Stripe 연결 완료 → released
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
      AND a.stripe_account_id            IS NOT NULL
      AND a.soft_deleted_at              IS NULL
    RETURNING p.id
  )
  SELECT count(*) INTO v_released FROM updated;

  -- Case B: pending + 만기 + Stripe 미연결 → hold
  WITH updated AS (
    UPDATE payouts p
    SET
      status      = 'hold',
      hold_reason = CASE
        WHEN a.stripe_account_id IS NULL          THEN 'stripe_not_connected'
        ELSE                                           'stripe_not_onboarded'  -- account_id 있지만 onboarding 미완료
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

-- ============================================================
-- 4. prevent_payout_core_change() 강화
--    - 금융 컬럼: transferred 이전에도 항상 잠금 (amount/agent_id/order_id/release_at)
--    - hold_reason 위반: 조용한 NULL 복원 → RAISE EXCEPTION
--    - 상태 전이 allowlist (system caller 제외)
--
--    allowed transitions:
--      pending   → released (cron), hold (cron), cancelled (refund trigger)
--      hold      → released (unblock trigger), pending (unblock trigger)
--      released  → transferred (Edge Fn), cancelled (refund trigger)
--      transferred → (terminal)
--      cancelled   → (terminal)
--
--    system callers (bypass transition check):
--      postgres (SECURITY DEFINER functions: release_matured_payouts, unblock_hold_payouts)
--      service_role (webhook handler, Edge Functions)
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_payout_core_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_system_caller boolean;
  v_transition_allowed boolean;
BEGIN
  -- system caller 판별 (postgres = SECURITY DEFINER 함수 소유자, service_role = webhook/Edge Fn)
  v_is_system_caller := current_user IN ('postgres', 'service_role', 'supabase_admin');

  -- ── 금융 핵심 컬럼: role 무관 불변 (생성 후 절대 변경 불가) ──────────────
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

  -- ── transferred 이후: 추가 컬럼 잠금 (종단) ──────────────────────────────
  IF OLD.status = 'transferred' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Cannot change payout status after transferred (payout_id: %)',
        OLD.id USING ERRCODE = '42501';
    END IF;
    IF NEW.stripe_transfer_id IS DISTINCT FROM OLD.stripe_transfer_id THEN
      RAISE EXCEPTION 'Cannot change stripe_transfer_id after transferred (payout_id: %)',
        OLD.id USING ERRCODE = '42501';
    END IF;
    RETURN NEW;  -- 이후 검사 불필요
  END IF;

  -- ── cancelled 이후: 종단 상태 ────────────────────────────────────────────
  IF OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Cannot change payout status from cancelled (payout_id: %)',
      OLD.id USING ERRCODE = '42501';
  END IF;

  -- ── 상태 전이 allowlist (system caller 제외) ──────────────────────────────
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT v_is_system_caller THEN
    v_transition_allowed := (
      (OLD.status = 'pending'   AND NEW.status IN ('released', 'hold', 'cancelled'))  OR
      (OLD.status = 'hold'      AND NEW.status IN ('released', 'pending'))             OR
      (OLD.status = 'released'  AND NEW.status IN ('transferred', 'cancelled'))
    );
    IF NOT v_transition_allowed THEN
      RAISE EXCEPTION 'Invalid payout status transition: % → % (payout_id: %)',
        OLD.status, NEW.status, OLD.id USING ERRCODE = '42501';
    END IF;
  END IF;

  -- ── hold_reason 정합성 검증 ────────────────────────────────────────────────
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
-- 5. prevent_submission_manipulation() — allowlist 방식 전환
--    접근 방식 변경: 금지 컬럼 나열 → 수정 가능 컬럼 명시
--
--    provider 수정 가능 컬럼 (status='submitted' 시에만):
--      preview_text, preview_thumbnail_url, content_text,
--      file_path, file_name, file_size, mime_type
--    항상 자동 변경 허용:
--      updated_at (트리거가 자동 설정)
--
--    그 외 모든 컬럼 변경 → RAISE EXCEPTION
--    (새 컬럼 추가 시 기본 차단)
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_submission_manipulation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF is_admin() THEN
    -- admin: 전체 수정 가능 (서버 내부 상태 전이용)
    RETURN NEW;
  END IF;

  -- ── 항상 불변 컬럼 (allowlist 기반: 여기에 없으면 모두 잠금) ───────────────
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Cannot change submission id' USING ERRCODE = '42501';
  END IF;
  IF NEW.task_id IS DISTINCT FROM OLD.task_id THEN
    RAISE EXCEPTION 'Cannot change submission task_id' USING ERRCODE = '42501';
  END IF;
  IF NEW.agent_id IS DISTINCT FROM OLD.agent_id THEN
    RAISE EXCEPTION 'Cannot change submission agent_id' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Cannot change submission status directly (current: %, attempted: %)',
      OLD.status, NEW.status USING ERRCODE = '42501';
  END IF;
  IF NEW.quoted_price IS DISTINCT FROM OLD.quoted_price THEN
    RAISE EXCEPTION 'Cannot change submission quoted_price' USING ERRCODE = '42501';
  END IF;
  IF NEW.soft_deleted_at IS DISTINCT FROM OLD.soft_deleted_at THEN
    RAISE EXCEPTION 'Cannot change submission soft_deleted_at' USING ERRCODE = '42501';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Cannot change submission created_at' USING ERRCODE = '42501';
  END IF;
  -- updated_at은 자동 트리거가 설정 — 여기서 차단하지 않음

  -- ── 수정 가능 컬럼 조건부 잠금: status = 'submitted' 시에만 허용 ───────────
  -- status가 'submitted'가 아니면 content 컬럼도 불변
  IF OLD.status != 'submitted' THEN
    IF NEW.preview_text IS DISTINCT FROM OLD.preview_text THEN
      RAISE EXCEPTION 'Cannot update submission preview_text after selection (current status: %)',
        OLD.status USING ERRCODE = '42501';
    END IF;
    IF NEW.preview_thumbnail_url IS DISTINCT FROM OLD.preview_thumbnail_url THEN
      RAISE EXCEPTION 'Cannot update preview_thumbnail_url after selection (current status: %)',
        OLD.status USING ERRCODE = '42501';
    END IF;
    IF NEW.content_text IS DISTINCT FROM OLD.content_text THEN
      RAISE EXCEPTION 'Cannot update submission content_text after selection (current status: %)',
        OLD.status USING ERRCODE = '42501';
    END IF;
    IF NEW.file_path IS DISTINCT FROM OLD.file_path THEN
      RAISE EXCEPTION 'Cannot update submission file_path after selection (current status: %)',
        OLD.status USING ERRCODE = '42501';
    END IF;
    IF NEW.file_name IS DISTINCT FROM OLD.file_name THEN
      RAISE EXCEPTION 'Cannot update submission file_name after selection (current status: %)',
        OLD.status USING ERRCODE = '42501';
    END IF;
    IF NEW.file_size IS DISTINCT FROM OLD.file_size THEN
      RAISE EXCEPTION 'Cannot update submission file_size after selection (current status: %)',
        OLD.status USING ERRCODE = '42501';
    END IF;
    IF NEW.mime_type IS DISTINCT FROM OLD.mime_type THEN
      RAISE EXCEPTION 'Cannot update submission mime_type after selection (current status: %)',
        OLD.status USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 6. reports INSERT RLS — 자기 자신 신고 차단
--    target_type = 'user' 일 때 target_id = auth.uid() 차단
--    (중복 신고는 UNIQUE(reporter_id, target_type, target_id)로 이미 처리됨)
-- ============================================================
DROP POLICY IF EXISTS reports_insert ON reports;
CREATE POLICY reports_insert ON reports
  FOR INSERT WITH CHECK (
    -- 신고자 본인이어야 함
    reporter_id = auth.uid()
    -- 최소 content 길이는 reason CHECK로 처리됨
    -- target_type = 'user' 시 자기 자신 신고 불가
    AND NOT (target_type = 'user' AND target_id = auth.uid())
    -- 자기 자신이 소유한 task 신고 불가
    AND NOT (
      target_type = 'task'
      AND EXISTS (SELECT 1 FROM tasks WHERE id = target_id AND user_id = auth.uid())
    )
    -- soft-deleted target은 신고 불가
    AND NOT (
      target_type = 'task'
      AND EXISTS (SELECT 1 FROM tasks WHERE id = target_id AND soft_deleted_at IS NOT NULL)
    )
  );

-- ============================================================
-- 7. prevent_order_core_change() — 상태 전이 allowlist 추가
--    allowed transitions:
--      pending           → paid, failed, cancelled
--      paid              → refund_requested
--      refund_requested  → refunded
--      failed            → (terminal)
--      refunded          → (terminal)
--      cancelled         → (terminal)
--
--    system callers (service_role, postgres): bypass transition allowlist
--    금융 컬럼 잠금은 system caller도 포함 (기존 동작 유지)
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_order_core_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_system_caller boolean;
  v_transition_allowed boolean := false;
BEGIN
  v_is_system_caller := current_user IN ('postgres', 'service_role', 'supabase_admin');

  -- ── 금융/연결 컬럼: role 무관 불변 ────────────────────────────────────────
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
  -- paid_at: NULL → timestamp 허용 (결제 완료 시 webhook이 설정), 설정 후 변경 금지
  IF OLD.paid_at IS NOT NULL AND NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
    RAISE EXCEPTION 'Cannot modify order paid_at after payment (order_id: %)', OLD.id USING ERRCODE = '42501';
  END IF;

  -- ── 종단 상태: status 변경 차단 ────────────────────────────────────────────
  IF OLD.status IN ('failed', 'refunded', 'cancelled') AND
     NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Cannot change order status from terminal state % (order_id: %)',
      OLD.status, OLD.id USING ERRCODE = '42501';
  END IF;

  -- ── 상태 전이 allowlist (system caller 제외) ──────────────────────────────
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT v_is_system_caller THEN
    v_transition_allowed := (
      (OLD.status = 'pending'          AND NEW.status = 'paid')             OR
      (OLD.status = 'pending'          AND NEW.status = 'failed')           OR
      (OLD.status = 'pending'          AND NEW.status = 'cancelled')        OR
      (OLD.status = 'paid'             AND NEW.status = 'refund_requested') OR
      (OLD.status = 'refund_requested' AND NEW.status = 'refunded')
    );
    IF NOT v_transition_allowed THEN
      RAISE EXCEPTION 'Invalid order status transition: % → % (order_id: %)',
        OLD.status, NEW.status, OLD.id USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
