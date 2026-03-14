-- ============================================================
-- Migration 018: state transition integrity + column-level immutability
-- Author: commongits-hub
-- 수정 항목:
--   1. get_user_role() — unknown role → NULL (조용한 user fallback 제거)
--   2. payouts.hold_reason CHECK 제약 — hold 아닌 상태에서 NULL 강제
--   3. prevent_submission_manipulation() — content 컬럼 status 기반 잠금 추가
--   4. prevent_review_manipulation() 트리거 — 역할별 컬럼 제한 + 7일 수정 창
--   5. prevent_payout_core_change() 트리거 — transferred 이후 핵심 컬럼 잠금
--   6. prevent_order_core_change() 트리거 — 금융 컬럼 완전 잠금 (admin 포함)
--   7. prevent_report_core_change() 트리거 — reporter_id/target 불변
-- ============================================================

-- ============================================================
-- 1. get_user_role() — unknown role → NULL
--    보수적 처리: 알 수 없는 app_role 값이면 NULL 반환
--    NULL IN ('user', 'provider', 'admin') = false → 모든 역할 기반 정책 거부
--    admin/provider 권한 누락 이슈가 'user' fallback으로 숨겨지지 않음
-- ============================================================
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS text AS $$
DECLARE
  v_role text;
BEGIN
  v_role := auth.jwt()->'app_metadata'->>'app_role';
  -- 미인증(anon) 또는 알 수 없는 값 → NULL (최소 권한, 조용한 fallback 없음)
  -- 올바른 클라이언트는 항상 user/provider/admin 중 하나
  IF v_role NOT IN ('user', 'provider', 'admin') THEN
    RETURN NULL;
  END IF;
  RETURN v_role;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

-- 의존 함수 재배포 (search_path 유지)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
  SELECT get_user_role() = 'admin';
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

-- ============================================================
-- 2. payouts.hold_reason CHECK 제약
--    status != 'hold' 상태에서 hold_reason IS NOT NULL이면 거부
--    released/pending/transferred/cancelled로 전환 시 hold_reason = NULL 강제
-- ============================================================
ALTER TABLE payouts
  ADD CONSTRAINT chk_hold_reason_null_when_not_hold
  CHECK (status = 'hold' OR hold_reason IS NULL);

-- ============================================================
-- 3. prevent_submission_manipulation() — content 컬럼 status 기반 잠금
--    provider는 status = 'submitted' 상태에서만 content/file 수정 가능
--    status가 그 이후(selected/purchased 이상)라면 내용 변경 불가
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_submission_manipulation()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT is_admin() THEN
    -- ── 상시 불변 컬럼 ─────────────────────────────────────
    IF NEW.task_id IS DISTINCT FROM OLD.task_id THEN
      RAISE EXCEPTION 'Cannot change task_id on submission' USING ERRCODE = '42501';
    END IF;
    IF NEW.agent_id IS DISTINCT FROM OLD.agent_id THEN
      RAISE EXCEPTION 'Cannot change agent_id on submission' USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Cannot change submission status directly (current: %, attempted: %)',
        OLD.status, NEW.status USING ERRCODE = '42501';
    END IF;
    IF NEW.quoted_price IS DISTINCT FROM OLD.quoted_price THEN
      RAISE EXCEPTION 'Cannot change quoted_price on submission' USING ERRCODE = '42501';
    END IF;
    IF NEW.selected_at IS DISTINCT FROM OLD.selected_at THEN
      RAISE EXCEPTION 'Cannot change selected_at on submission' USING ERRCODE = '42501';
    END IF;
    IF NEW.delivered_at IS DISTINCT FROM OLD.delivered_at THEN
      RAISE EXCEPTION 'Cannot change delivered_at on submission' USING ERRCODE = '42501';
    END IF;
    IF NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
      RAISE EXCEPTION 'Cannot change approved_at on submission' USING ERRCODE = '42501';
    END IF;
    IF NEW.soft_deleted_at IS DISTINCT FROM OLD.soft_deleted_at THEN
      RAISE EXCEPTION 'Cannot change soft_deleted_at on submission' USING ERRCODE = '42501';
    END IF;

    -- ── content 컬럼: status = 'submitted' 이후에만 수정 허용 ──
    -- selected/purchased 이상으로 넘어간 제출물의 내용 변경 방지
    IF OLD.status != 'submitted' THEN
      IF NEW.content_text IS DISTINCT FROM OLD.content_text OR
         NEW.file_path    IS DISTINCT FROM OLD.file_path    OR
         NEW.file_name    IS DISTINCT FROM OLD.file_name    OR
         NEW.file_size    IS DISTINCT FROM OLD.file_size    OR
         NEW.mime_type    IS DISTINCT FROM OLD.mime_type
      THEN
        RAISE EXCEPTION 'Cannot update submission content after selection (current status: %)',
          OLD.status USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ============================================================
-- 4. prevent_review_manipulation() — 역할별 컬럼 제한 + 7일 수정 창
--    user(리뷰 작성자): rating, content만 수정 가능, 7일 이내
--    admin: status(published/flagged/hidden) 변경 가능
--    불변 컬럼: order_id, user_id, agent_id, created_at
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_review_manipulation()
RETURNS TRIGGER AS $$
BEGIN
  -- ── 불변 컬럼 (role 무관) ──────────────────────────────
  IF NEW.order_id IS DISTINCT FROM OLD.order_id THEN
    RAISE EXCEPTION 'Cannot change order_id on review' USING ERRCODE = '42501';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Cannot change user_id on review' USING ERRCODE = '42501';
  END IF;
  IF NEW.agent_id IS DISTINCT FROM OLD.agent_id THEN
    RAISE EXCEPTION 'Cannot change agent_id on review' USING ERRCODE = '42501';
  END IF;

  -- ── 역할별 제한 ────────────────────────────────────────
  IF is_admin() THEN
    -- admin: status 변경 가능, rating/content는 수정 불가 (무결성)
    IF NEW.rating IS DISTINCT FROM OLD.rating OR
       NEW.content IS DISTINCT FROM OLD.content
    THEN
      RAISE EXCEPTION 'Admin cannot edit review rating or content, only status'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    -- 일반 user: rating, content만 수정 가능
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Only admin can change review status (current: %, attempted: %)',
        OLD.status, NEW.status USING ERRCODE = '42501';
    END IF;

    -- 7일 수정 창 검증
    IF NOW() > OLD.created_at + INTERVAL '7 days' THEN
      RAISE EXCEPTION 'Review editing window has expired (7 days from creation: %)',
        OLD.created_at USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_prevent_review_manipulation ON reviews;
CREATE TRIGGER trg_prevent_review_manipulation
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION prevent_review_manipulation();

-- ============================================================
-- 5. prevent_payout_core_change() — transferred 이후 핵심 컬럼 잠금
--    transferred 상태: amount, agent_id, order_id, stripe_transfer_id 불변
--    상태 전이 보호: cancelled/hold → transferred 직접 전환 차단
--    (released → transferred만 허용; 다른 경로는 Edge Function 경유)
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_payout_core_change()
RETURNS TRIGGER AS $$
BEGIN
  -- transferred 이후에는 핵심 컬럼 불변 (admin도 포함 — 금융 데이터)
  IF OLD.status = 'transferred' THEN
    IF NEW.amount IS DISTINCT FROM OLD.amount OR
       NEW.agent_id IS DISTINCT FROM OLD.agent_id OR
       NEW.order_id IS DISTINCT FROM OLD.order_id OR
       NEW.stripe_transfer_id IS DISTINCT FROM OLD.stripe_transfer_id
    THEN
      RAISE EXCEPTION 'Cannot modify core payout columns after transfer (payout_id: %)',
        OLD.id USING ERRCODE = '42501';
    END IF;
    -- transferred 상태에서 status 변경도 금지 (완료된 정산은 되돌릴 수 없음)
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Cannot change payout status after transferred (payout_id: %)',
        OLD.id USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 상태 전이 allowlist (admin이 아닌 경우)
  IF NOT is_admin() THEN
    -- released → transferred는 Edge Function(service_role)만 실행
    -- RLS가 admin 전용 UPDATE 정책을 강제하므로, 여기서는 SECURITY DEFINER 맥락
    -- 비정상 전이 차단: pending/hold/cancelled → transferred 금지
    IF NEW.status = 'transferred' AND OLD.status != 'released' THEN
      RAISE EXCEPTION 'Payout can only be transferred from released state (current: %)',
        OLD.status USING ERRCODE = '42501';
    END IF;
  END IF;

  -- hold_reason 정합성: hold 아닌 상태로 전환 시 hold_reason 자동 초기화
  -- (CHECK 제약과 함께 이중 보호)
  IF NEW.status != 'hold' THEN
    NEW.hold_reason := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_prevent_payout_core_change ON payouts;
CREATE TRIGGER trg_prevent_payout_core_change
  BEFORE UPDATE ON payouts
  FOR EACH ROW EXECUTE FUNCTION prevent_payout_core_change();

-- ============================================================
-- 6. prevent_order_core_change() — 금융 컬럼 완전 잠금 (admin 포함)
--    orders의 금융 컬럼은 생성 후 절대 변경 불가
--    status 전이: webhook(service_role)이 paid/failed/refunded 등으로 변경
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_order_core_change()
RETURNS TRIGGER AS $$
BEGIN
  -- 금융 컬럼: admin 포함 누구도 변경 불가
  -- (결제 원장 데이터 — 변경 시 회계 불일치 발생)
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

  -- 연결 컬럼: 불변
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Cannot modify order user_id (order_id: %)', OLD.id USING ERRCODE = '42501';
  END IF;
  IF NEW.task_id IS DISTINCT FROM OLD.task_id THEN
    RAISE EXCEPTION 'Cannot modify order task_id (order_id: %)', OLD.id USING ERRCODE = '42501';
  END IF;
  IF NEW.submission_id IS DISTINCT FROM OLD.submission_id THEN
    RAISE EXCEPTION 'Cannot modify order submission_id (order_id: %)', OLD.id USING ERRCODE = '42501';
  END IF;

  -- Stripe 식별자: 불변 (생성 후 변경 불가)
  IF NEW.stripe_checkout_session_id IS DISTINCT FROM OLD.stripe_checkout_session_id THEN
    RAISE EXCEPTION 'Cannot modify order stripe_checkout_session_id (order_id: %)', OLD.id USING ERRCODE = '42501';
  END IF;
  IF NEW.stripe_payment_intent_id IS DISTINCT FROM OLD.stripe_payment_intent_id THEN
    RAISE EXCEPTION 'Cannot modify order stripe_payment_intent_id (order_id: %)', OLD.id USING ERRCODE = '42501';
  END IF;

  -- paid 이후 paid_at 변경 불가
  IF OLD.paid_at IS NOT NULL AND NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
    RAISE EXCEPTION 'Cannot modify order paid_at after payment (order_id: %)', OLD.id USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_prevent_order_core_change ON orders;
CREATE TRIGGER trg_prevent_order_core_change
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION prevent_order_core_change();

-- ============================================================
-- 7. prevent_report_core_change() — reporter_id/target 불변
--    신고 접수 후 신고자/대상 변경 불가 (운영 무결성)
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_report_core_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.reporter_id IS DISTINCT FROM OLD.reporter_id THEN
    RAISE EXCEPTION 'Cannot change reporter_id on report' USING ERRCODE = '42501';
  END IF;
  IF NEW.target_type IS DISTINCT FROM OLD.target_type THEN
    RAISE EXCEPTION 'Cannot change target_type on report' USING ERRCODE = '42501';
  END IF;
  IF NEW.target_id IS DISTINCT FROM OLD.target_id THEN
    RAISE EXCEPTION 'Cannot change target_id on report' USING ERRCODE = '42501';
  END IF;
  -- reason도 불변 (신고 사유는 수정 불가)
  IF NEW.reason IS DISTINCT FROM OLD.reason THEN
    RAISE EXCEPTION 'Cannot change report reason after submission' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_prevent_report_core_change ON reports;
CREATE TRIGGER trg_prevent_report_core_change
  BEFORE UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION prevent_report_core_change();
