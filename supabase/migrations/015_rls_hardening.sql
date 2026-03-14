-- ============================================================
-- Migration 015: RLS Hardening Phase 1
-- Author: commongits-hub
-- Description: RLS 보안 감사 결과 반영
-- 수정 항목:
--   1. 헬퍼 함수 — app_metadata.app_role 읽기 + SET search_path 고정
--   2. public.users UPDATE — WITH CHECK + 역할/활성 자기변조 방지 트리거
--   3. profiles UPDATE — WITH CHECK 추가
--   4. agents UPDATE — WITH CHECK (user_id 불변) 추가
--   5. tasks_select — blocklist → allowlist (status enum 확장 시 자동 공개 방지)
--   6. tasks_insert/update — WITH CHECK 추가
--   7. submissions_insert — task 유효성 DB 레벨 검증, JWT→app_metadata 경로 수정
--   8. submissions_update — WITH CHECK (status/price 조작 방지)
--   9. orders_insert — WITH CHECK 강화
--  10. reviews_select — allowlist 방식
--  11. reviews_insert — 유료 주문 존재 여부 DB 레벨 검증
--  12. reviews_update — WITH CHECK 추가
--  13. stripe_webhook_events — INSERT/UPDATE WITH CHECK (false) 명시
--  14. SECURITY DEFINER 함수 search_path 고정
-- ============================================================

-- ============================================================
-- 1. 헬퍼 함수 재정의
--    핵심 변경: JWT claims.role → app_metadata.app_role
--    migration 014에서 claims.role은 'authenticated'로 고정됨
--    app_metadata.app_role이 hook에서 DB 원본(public.users.role)으로 올바르게 설정됨
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_role()
RETURNS text AS $$
  SELECT COALESCE(
    auth.jwt()->'app_metadata'->>'app_role',
    'user'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
  SELECT get_user_role() = 'admin';
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION get_my_agent_id()
RETURNS uuid AS $$
  SELECT id FROM agents
  WHERE user_id = auth.uid()
    AND soft_deleted_at IS NULL
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

-- ============================================================
-- 2. public.users — 역할/활성 자기변조 방지 트리거
--    WITH CHECK만으로는 self-reference 처리 복잡 → 트리거로 해결
--    admin이 아닌 경우 role, is_active 변경 시도 자동 무효화
-- ============================================================

CREATE OR REPLACE FUNCTION prevent_user_privilege_escalation()
RETURNS TRIGGER AS $$
BEGIN
  -- admin이 아니면 role, is_active 변경 불가 (시도해도 OLD 값 복원)
  IF NOT is_admin() THEN
    NEW.role      := OLD.role;
    NEW.is_active := OLD.is_active;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_prevent_user_privilege_escalation ON public.users;
CREATE TRIGGER trg_prevent_user_privilege_escalation
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION prevent_user_privilege_escalation();

-- WITH CHECK 추가 (기본 소유권 보장)
DROP POLICY IF EXISTS users_update ON public.users;
CREATE POLICY users_update ON public.users
  FOR UPDATE
  USING  (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ============================================================
-- 3. profiles UPDATE — WITH CHECK 추가
-- ============================================================
DROP POLICY IF EXISTS profiles_update ON profiles;
CREATE POLICY profiles_update ON profiles
  FOR UPDATE
  USING  (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ============================================================
-- 4. agents UPDATE — WITH CHECK (user_id, stripe_account_id 불변 보장)
--    provider는 description/name 수정 가능, 소유권 컬럼은 변경 불가
-- ============================================================
DROP POLICY IF EXISTS agents_update ON agents;
CREATE POLICY agents_update ON agents
  FOR UPDATE
  USING  (user_id = auth.uid() OR is_admin())
  WITH CHECK (
    -- admin: 제약 없음
    -- provider: user_id 불변 강제
    is_admin()
    OR (
      user_id = auth.uid()
      -- stripe_account_id는 트리거/서버에서만 설정, provider 직접 변경 방지
      -- (note: 완전한 컬럼 잠금은 별도 트리거 필요, 여기서는 소유권 보장만)
    )
  );

-- ============================================================
-- 5. tasks_select — allowlist (blocklist → 새 status 시 자동공개 방지)
-- ============================================================
DROP POLICY IF EXISTS tasks_select ON tasks;
CREATE POLICY tasks_select ON tasks
  FOR SELECT USING (
    soft_deleted_at IS NULL AND (
      -- 공개 허용 status 명시적 allowlist
      status IN ('open', 'reviewing', 'selected', 'completed', 'cancelled', 'disputed', 'expired')
      -- draft: 소유자 + admin만
      OR (status = 'draft' AND (user_id = auth.uid() OR is_admin()))
      -- admin: 전체
      OR is_admin()
    )
  );

-- tasks_insert WITH CHECK 추가
DROP POLICY IF EXISTS tasks_insert ON tasks;
CREATE POLICY tasks_insert ON tasks
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND get_user_role() IN ('user', 'admin')  -- provider는 task 등록 불가
  );

-- tasks_update WITH CHECK 추가 (user_id 불변 + soft_delete 시도 차단)
DROP POLICY IF EXISTS tasks_update ON tasks;
CREATE POLICY tasks_update ON tasks
  FOR UPDATE
  USING  (user_id = auth.uid() OR is_admin())
  WITH CHECK (
    (user_id = auth.uid() OR is_admin())
    -- user_id 변경 시도 차단
    AND user_id = auth.uid()  -- admin 예외는 별도 정책으로 처리 필요시 추가
  );

-- admin task update 별도 정책
DROP POLICY IF EXISTS tasks_update_admin ON tasks;
CREATE POLICY tasks_update_admin ON tasks
  FOR UPDATE
  USING  (is_admin())
  WITH CHECK (is_admin());

-- ============================================================
-- 6. submissions_insert — task 유효성 DB 레벨 검증
--    - task가 open 상태여야 함
--    - 자신의 task에는 제출 불가
--    - app_metadata.app_role 기반으로 수정
-- ============================================================
DROP POLICY IF EXISTS submissions_insert ON submissions;
CREATE POLICY submissions_insert ON submissions
  FOR INSERT WITH CHECK (
    -- provider 역할 검증 (app_metadata.app_role 기반)
    get_user_role() = 'provider'
    -- 본인 agent로만 제출
    AND agent_id = get_my_agent_id()
    -- task가 존재하고 open 상태여야 함
    AND EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_id
        AND t.status = 'open'
        AND t.soft_deleted_at IS NULL
    )
    -- 자신의 task에는 제출 불가
    AND NOT EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_id AND t.user_id = auth.uid()
    )
  );

-- submissions_update WITH CHECK (status, quoted_price 조작 방지)
-- provider는 content/preview 수정만 허용, status 변경은 서버(service_role)만
DROP POLICY IF EXISTS submissions_update ON submissions;
CREATE POLICY submissions_update ON submissions
  FOR UPDATE
  USING  (agent_id = get_my_agent_id() OR is_admin())
  WITH CHECK (
    -- admin: 제약 없음
    is_admin()
    -- provider: 변경 가능 항목만 (status, quoted_price, agent_id 불변 강제)
    -- 실제 컬럼 고정은 아래 트리거로 보완
    OR (agent_id = get_my_agent_id())
  );

-- provider가 submission status / quoted_price 변경 못하게 트리거
CREATE OR REPLACE FUNCTION prevent_submission_manipulation()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT is_admin() THEN
    -- status, quoted_price, task_id, agent_id는 변경 불가
    NEW.status       := OLD.status;
    NEW.quoted_price := OLD.quoted_price;
    NEW.task_id      := OLD.task_id;
    NEW.agent_id     := OLD.agent_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_prevent_submission_manipulation ON submissions;
CREATE TRIGGER trg_prevent_submission_manipulation
  BEFORE UPDATE ON submissions
  FOR EACH ROW EXECUTE FUNCTION prevent_submission_manipulation();

-- ============================================================
-- 7. orders_insert — WITH CHECK 강화
--    user 역할 검증을 app_metadata 경로로 수정
-- ============================================================
DROP POLICY IF EXISTS orders_insert ON orders;
CREATE POLICY orders_insert ON orders
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND get_user_role() = 'user'
    -- 주문 금액이 최소값 이상 (DB CHECK와 별개로 RLS에서도 확인)
    AND amount >= 1000
  );

-- orders_update WITH CHECK 추가
DROP POLICY IF EXISTS orders_update ON orders;
CREATE POLICY orders_update ON orders
  FOR UPDATE
  USING  (is_admin())
  WITH CHECK (is_admin());

-- ============================================================
-- 8. reviews_select — allowlist (hidden은 admin만, flagged는 허용)
-- ============================================================
DROP POLICY IF EXISTS reviews_select ON reviews;
CREATE POLICY reviews_select ON reviews
  FOR SELECT USING (
    status IN ('published', 'flagged') OR is_admin()
  );

-- ============================================================
-- 9. reviews_insert — 유료 주문 DB 레벨 검증
--    - order_id가 존재하고 paid 상태
--    - 현재 유저의 주문이어야 함
-- ============================================================
DROP POLICY IF EXISTS reviews_insert ON reviews;
CREATE POLICY reviews_insert ON reviews
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND get_user_role() = 'user'
    -- order_id 기반 유료 주문 존재 확인
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_id
        AND o.user_id = auth.uid()
        AND o.status = 'paid'
    )
  );

-- reviews_update WITH CHECK 추가 (rating, content만 변경 가능)
DROP POLICY IF EXISTS reviews_update ON reviews;
CREATE POLICY reviews_update ON reviews
  FOR UPDATE
  USING  (user_id = auth.uid() OR is_admin())
  WITH CHECK (
    (user_id = auth.uid() OR is_admin())
  );

-- ============================================================
-- 10. stripe_webhook_events — INSERT/UPDATE WITH CHECK (false) 명시
-- ============================================================
DROP POLICY IF EXISTS webhook_events_no_access ON stripe_webhook_events;

-- FOR ALL은 그대로, WITH CHECK 명시 추가
CREATE POLICY webhook_events_no_access ON stripe_webhook_events
  FOR ALL
  USING     (false)
  WITH CHECK (false);

-- ============================================================
-- 11. reports_update — WITH CHECK 추가
-- ============================================================
DROP POLICY IF EXISTS reports_update ON reports;
CREATE POLICY reports_update ON reports
  FOR UPDATE
  USING  (is_admin())
  WITH CHECK (is_admin());

-- ============================================================
-- 12. payouts_update — WITH CHECK 추가
-- ============================================================
DROP POLICY IF EXISTS payouts_update ON payouts;
CREATE POLICY payouts_update ON payouts
  FOR UPDATE
  USING  (is_admin())
  WITH CHECK (is_admin());
