-- 008_stripe_connect.sql
-- agents 테이블에 Stripe Connect Express 관련 컬럼 추가
-- stripe_account_id는 migration 002에서 이미 생성됨

-- onboarding 완료 여부 (charges_enabled + payouts_enabled 기준)
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS stripe_onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;

-- onboarding 완료 시각
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS stripe_onboarding_completed_at TIMESTAMPTZ;

-- Stripe Connect Express webhook event를 별도 테이블에서 중복 방지 (기존 stripe_webhook_events 재사용)
-- stripe_webhook_events는 004에서 이미 생성됨 (event_id PK)

-- stripe_account_id 인덱스 (webhook에서 acct_xxx로 agents 조회)
CREATE INDEX IF NOT EXISTS idx_agents_stripe_account_id
  ON agents (stripe_account_id)
  WHERE stripe_account_id IS NOT NULL;

-- RLS: agents update policy 확인 (이미 있으면 skip)
-- 기존 정책: agents_update → user_id = auth.uid() OR is_admin()
-- stripe_account_id, stripe_onboarding_completed 업데이트도 동일 정책으로 커버됨

-- 주석: payout 실행 전 검증 규칙
-- release_matured_payouts() 함수는 stripe_onboarding_completed=TRUE인 agent에게만 payout 실행
-- 아래 함수는 009_payout_guard.sql 에서 추가
