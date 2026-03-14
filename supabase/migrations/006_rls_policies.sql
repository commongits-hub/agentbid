-- ============================================================
-- Migration 006: Row Level Security (RLS) 정책
-- Author: commongits-hub
-- Description: 전체 테이블 RLS 활성화 및 정책 정의
-- 선행: 005_create_reviews_follows_reports.sql
-- 주의: service_role_key는 RLS 우회 가능 (API 서버에서만 사용)
--       anon/authenticated role은 이 정책에 완전히 종속
-- ============================================================

-- ============================================================
-- RLS 활성화
-- ============================================================
ALTER TABLE public.users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents                ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_categories      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_attachments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders                ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews               ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows               ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports               ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_policies          ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 헬퍼 함수
-- ============================================================

-- 현재 유저의 role 반환 (JWT claim 기반)
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS text AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::jsonb->>'role',
    'anon'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 현재 유저가 admin인지 확인
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
  SELECT get_user_role() = 'admin';
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 현재 유저의 agent_id 반환
CREATE OR REPLACE FUNCTION get_my_agent_id()
RETURNS uuid AS $$
  SELECT id FROM agents
  WHERE user_id = auth.uid()
    AND soft_deleted_at IS NULL
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- public.users RLS
-- ============================================================
-- 본인 또는 admin만 조회
CREATE POLICY users_select ON public.users
  FOR SELECT USING (id = auth.uid() OR is_admin());

-- 본인만 업데이트 (role, is_active 제외 → API 레벨에서 강제)
CREATE POLICY users_update ON public.users
  FOR UPDATE USING (id = auth.uid());

-- INSERT는 트리거에서만 (handle_new_user)
-- 직접 INSERT 불가

-- ============================================================
-- profiles RLS
-- ============================================================
-- 모든 공개 프로필 조회 허용
CREATE POLICY profiles_select ON profiles
  FOR SELECT USING (true);

-- 본인만 수정
CREATE POLICY profiles_update ON profiles
  FOR UPDATE USING (id = auth.uid());

-- ============================================================
-- agents RLS
-- ============================================================
-- soft_delete 안된 agent는 모두 공개
CREATE POLICY agents_select ON agents
  FOR SELECT USING (soft_deleted_at IS NULL OR is_admin());

-- 본인 agent만 수정
CREATE POLICY agents_update ON agents
  FOR UPDATE USING (user_id = auth.uid() OR is_admin());

-- ============================================================
-- agent_categories RLS
-- ============================================================
CREATE POLICY agent_categories_select ON agent_categories
  FOR SELECT USING (true);

CREATE POLICY agent_categories_insert ON agent_categories
  FOR INSERT WITH CHECK (
    agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid())
  );

CREATE POLICY agent_categories_delete ON agent_categories
  FOR DELETE USING (
    agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid())
    OR is_admin()
  );

-- ============================================================
-- tasks RLS
-- ============================================================
-- draft는 소유자/admin만, 나머지는 soft_delete 아닌 것만
CREATE POLICY tasks_select ON tasks
  FOR SELECT USING (
    soft_deleted_at IS NULL AND (
      status != 'draft' OR user_id = auth.uid() OR is_admin()
    )
  );

-- 본인만 등록
CREATE POLICY tasks_insert ON tasks
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- 본인 또는 admin만 수정
CREATE POLICY tasks_update ON tasks
  FOR UPDATE USING (user_id = auth.uid() OR is_admin());

-- ============================================================
-- task_attachments RLS
-- ============================================================
-- task 소유자, 제출한 provider, admin만 조회
CREATE POLICY task_attachments_select ON task_attachments
  FOR SELECT USING (
    is_admin()
    OR task_id IN (SELECT id FROM tasks WHERE user_id = auth.uid())
    OR task_id IN (
      SELECT DISTINCT s.task_id FROM submissions s
      JOIN agents a ON s.agent_id = a.id
      WHERE a.user_id = auth.uid() AND s.soft_deleted_at IS NULL
    )
  );

CREATE POLICY task_attachments_insert ON task_attachments
  FOR INSERT WITH CHECK (
    task_id IN (SELECT id FROM tasks WHERE user_id = auth.uid())
  );

-- ============================================================
-- submissions RLS
-- ============================================================
-- 조회 정책:
--   A. admin: 전체
--   B. task 소유자: row 접근 허용 (file_path, content_text는 API 레벨에서 제거)
--   C. 제출한 provider 본인: 본인 submission 전체
--
-- ⚠️ 중요: DB 레벨에서 컬럼 마스킹 없음
-- → API 응답에서 반드시 아래 필드 필터링 강제 필요:
--   task owner (미결제) 응답: file_path, content_text 제거
--   task owner (결제 완료, submission.status=purchased): 전체 허용
--   provider 본인: 전체 허용
--   기타: preview_text, preview_thumbnail_url, quoted_price, agent 정보만
--
-- API 응답 shaping 예시 (TypeScript):
--   if (isTaskOwner && submission.status !== 'purchased') {
--     delete submission.file_path
--     delete submission.content_text
--   }
CREATE POLICY submissions_select ON submissions
  FOR SELECT USING (
    soft_deleted_at IS NULL AND (
      is_admin()
      OR task_id IN (SELECT id FROM tasks WHERE user_id = auth.uid())
      OR agent_id = get_my_agent_id()
    )
  );

-- provider만 제출 가능
CREATE POLICY submissions_insert ON submissions
  FOR INSERT WITH CHECK (
    get_user_role() = 'provider'
    AND agent_id = get_my_agent_id()
  );

-- provider 본인 또는 admin만 수정
CREATE POLICY submissions_update ON submissions
  FOR UPDATE USING (
    agent_id = get_my_agent_id() OR is_admin()
  );

-- ============================================================
-- orders RLS
-- ============================================================
-- 본인 주문 또는 admin만 조회
CREATE POLICY orders_select ON orders
  FOR SELECT USING (user_id = auth.uid() OR is_admin());

-- user만 생성 (provider/admin은 주문 불가)
CREATE POLICY orders_insert ON orders
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND get_user_role() = 'user'
  );

-- 상태 변경은 webhook 처리(service_role) 또는 admin만
-- authenticated role에서는 UPDATE 차단 → API에서 service_role 사용
CREATE POLICY orders_update ON orders
  FOR UPDATE USING (is_admin());

-- ============================================================
-- payouts RLS
-- ============================================================
-- 해당 agent 또는 admin만 조회
CREATE POLICY payouts_select ON payouts
  FOR SELECT USING (
    agent_id = get_my_agent_id() OR is_admin()
  );

-- INSERT/UPDATE는 트리거(service_role) 또는 admin만
CREATE POLICY payouts_update ON payouts
  FOR UPDATE USING (is_admin());

-- ============================================================
-- reviews RLS
-- ============================================================
-- hidden 제외, 공개 조회 허용
CREATE POLICY reviews_select ON reviews
  FOR SELECT USING (
    status != 'hidden' OR is_admin()
  );

-- 결제 완료한 user만 작성 (validation은 API 레벨에서 추가)
CREATE POLICY reviews_insert ON reviews
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND get_user_role() = 'user'
  );

-- 본인 또는 admin만 수정 (7일 이내 체크는 API 레벨)
CREATE POLICY reviews_update ON reviews
  FOR UPDATE USING (user_id = auth.uid() OR is_admin());

-- ============================================================
-- follows RLS
-- ============================================================
CREATE POLICY follows_select ON follows
  FOR SELECT USING (true);

CREATE POLICY follows_insert ON follows
  FOR INSERT WITH CHECK (follower_id = auth.uid());

CREATE POLICY follows_delete ON follows
  FOR DELETE USING (follower_id = auth.uid());

-- ============================================================
-- reports RLS
-- ============================================================
-- 본인 신고 또는 admin만 조회
CREATE POLICY reports_select ON reports
  FOR SELECT USING (reporter_id = auth.uid() OR is_admin());

CREATE POLICY reports_insert ON reports
  FOR INSERT WITH CHECK (reporter_id = auth.uid());

-- admin만 상태 변경
CREATE POLICY reports_update ON reports
  FOR UPDATE USING (is_admin());

-- ============================================================
-- fee_policies RLS
-- ============================================================
-- admin만 전체 조회/수정
CREATE POLICY fee_policies_select ON fee_policies
  FOR SELECT USING (is_admin());

CREATE POLICY fee_policies_insert ON fee_policies
  FOR INSERT WITH CHECK (is_admin());

-- ============================================================
-- stripe_webhook_events RLS
-- ============================================================
-- API 서버(service_role)에서만 접근, authenticated 차단
CREATE POLICY webhook_events_no_access ON stripe_webhook_events
  FOR ALL USING (false);
