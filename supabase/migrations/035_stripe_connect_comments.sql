-- ============================================================
-- Migration 035: 008_stripe_connect 주석 명확화
-- 구조/DDL 변경 없음 — COMMENT 추가만
--
-- 008은 컬럼/인덱스 추가만 하는 "구조 추가 migration"
-- 정산 가드/상태 전이 보장은 009_payout_guard.sql에서 시작
-- ============================================================

-- ------------------------------------------------------------
-- agents: Stripe Connect 컬럼 의도 명시
--   stripe_onboarding_completed
--     - source of truth = Stripe account status (charges_enabled + payouts_enabled)
--     - 갱신 주체: Stripe webhook → service_role 경로
--     - user 직접 수정 불허 (API 레벨 통제, RLS agents_update는 row 접근 허용이지 컬럼 허용이 아님)
--   정산 가드 (onboarding=TRUE 조건)는 이 migration에 없음 → 009_payout_guard.sql에서 적용
-- ------------------------------------------------------------
COMMENT ON COLUMN agents.stripe_onboarding_completed IS
  'Stripe Connect Express 온보딩 완료 여부 (charges_enabled + payouts_enabled 기준). '
  'source of truth = Stripe account status. '
  'webhook/service_role 경로로만 갱신 — user 직접 수정 불허 (API 레벨 통제). '
  '정산 가드 로직은 009_payout_guard.sql에서 적용됨.';

COMMENT ON COLUMN agents.stripe_onboarding_completed_at IS
  'Stripe Connect Express 온보딩 완료 시각. '
  'webhook 수신 시 service_role로 갱신.';
