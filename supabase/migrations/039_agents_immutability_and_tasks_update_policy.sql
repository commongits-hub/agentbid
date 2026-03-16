-- ============================================================
-- Migration 039: agents 컬럼 immutability 트리거 + tasks_update 정책 분리
--
-- 해소 항목 (015 리뷰 잔여 2건):
--   A. agents.stripe_account_id / user_id / stripe_onboarding_* immutability
--      - 015 agents_update 정책은 소유권만 보장 (컬럼 잠금 미적용)
--      - 주석에 "완전한 컬럼 잠금은 별도 트리거 필요"로 남겨진 항목
--      - 이 migration에서 BEFORE UPDATE trigger로 완결
--   B. tasks_update 정책 owner/admin 혼합 표현 제거
--      - WITH CHECK (user_id = auth.uid()) 이 admin 경로도 막을 수 있어 혼란
--      - tasks_update (owner 전용) + tasks_update_admin 완전 분리
--      - 015의 tasks_update_admin은 이미 존재하나 tasks_update WITH CHECK 혼용 문제 해소
--
-- 원칙:
--   - provider는 name/description/profile성 필드만 수정 가능
--   - stripe_account_id, stripe_onboarding_completed, stripe_onboarding_completed_at,
--     user_id는 admin 또는 service_role 경로에서만 변경 가능
--   - SECURITY DEFINER + SET search_path = public
-- ============================================================

-- ============================================================
-- A-1. prevent_agent_core_change() — agents 핵심 컬럼 불변 트리거
--      대상 컬럼:
--        - user_id                       (소유권)
--        - stripe_account_id             (Stripe Connect 계정 ID)
--        - stripe_onboarding_completed   (온보딩 완료 여부)
--        - stripe_onboarding_completed_at (온보딩 완료 시각)
--      bypass 조건 (모두 허용):
--        - is_admin(): JWT app_role = 'admin'
--        - pg_trigger_depth() > 0: 내부 트리거 체인 (payout guard 등)
--        - current_role IN ('service_role', 'supabase_admin', 'postgres'):
--          Edge Function / webhook / 서버 직접 업데이트 경로
--          (service_role는 auth.jwt() 없으므로 is_admin() 판별 불가)
--      non-admin 일반 provider는 위 컬럼 변경 시도 시 OLD 값으로 복원
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_agent_core_change()
RETURNS TRIGGER AS $$
BEGIN
  -- bypass 조건 (아래 중 하나라도 해당하면 허용):
  --   1. is_admin(): JWT app_role = 'admin' (로그인 admin 유저)
  --   2. pg_trigger_depth() > 0: 다른 트리거에서 호출된 내부 체인
  --   3. service_role / supabase_admin / postgres:
  --      Edge Function, webhook handler 등 서버 측 직접 업데이트 경로
  --      auth.jwt()가 없으므로 is_admin()으로는 판별 불가 → current_role로 판별
  IF is_admin()
     OR pg_trigger_depth() > 0
     OR current_role IN ('service_role', 'supabase_admin', 'postgres')
  THEN
    RETURN NEW;
  END IF;

  -- non-admin: 핵심 컬럼 변경 시도 → OLD 값 복원
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    NEW.user_id := OLD.user_id;
  END IF;

  IF NEW.stripe_account_id IS DISTINCT FROM OLD.stripe_account_id THEN
    NEW.stripe_account_id := OLD.stripe_account_id;
  END IF;

  IF NEW.stripe_onboarding_completed IS DISTINCT FROM OLD.stripe_onboarding_completed THEN
    NEW.stripe_onboarding_completed := OLD.stripe_onboarding_completed;
  END IF;

  IF NEW.stripe_onboarding_completed_at IS DISTINCT FROM OLD.stripe_onboarding_completed_at THEN
    NEW.stripe_onboarding_completed_at := OLD.stripe_onboarding_completed_at;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- EXECUTE 권한 제한 (direct invocation 방지)
REVOKE EXECUTE ON FUNCTION prevent_agent_core_change() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_prevent_agent_core_change ON agents;
CREATE TRIGGER trg_prevent_agent_core_change
  BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION prevent_agent_core_change();

-- ============================================================
-- A-2. agents_update 정책 주석 정리
--      015의 "완전한 컬럼 잠금은 별도 트리거 필요" 주석을
--      "실제 컬럼 불변성은 trg_prevent_agent_core_change 트리거에서 강제"로 교체
--      정책 USING/WITH CHECK 로직은 그대로 유지 (소유권 보장)
-- ============================================================
DROP POLICY IF EXISTS agents_update ON agents;
CREATE POLICY agents_update ON agents
  FOR UPDATE
  USING  (user_id = auth.uid() OR is_admin())
  WITH CHECK (
    is_admin()
    OR user_id = auth.uid()
    -- stripe_account_id / stripe_onboarding_* / user_id 컬럼 불변성은
    -- trg_prevent_agent_core_change (BEFORE UPDATE 트리거)에서 강제됨
    -- 이 정책은 소유권(owner or admin)만 검증
  );

-- ============================================================
-- B. tasks_update 정책 owner/admin 완전 분리
--    기존 015:
--      tasks_update WITH CHECK (user_id = auth.uid() OR is_admin()) AND user_id = auth.uid()
--      → admin 경로에서 WITH CHECK의 user_id = auth.uid() 가 admin uid를 요구하여 혼란
--    수정:
--      tasks_update    → owner 전용 (user_id = auth.uid())
--      tasks_update_admin → admin 전용 (is_admin())
--      두 정책이 permissive OR 로 동작 → 실질 동작 동일하나 의도 명확
-- ============================================================
DROP POLICY IF EXISTS tasks_update ON tasks;
CREATE POLICY tasks_update ON tasks
  FOR UPDATE
  USING     (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
  -- owner만: 자기 task만 수정 가능
  -- admin 경로는 tasks_update_admin 에서만 처리

-- tasks_update_admin은 015에서 이미 존재하나 명시적 재정의로 완결성 보장
DROP POLICY IF EXISTS tasks_update_admin ON tasks;
CREATE POLICY tasks_update_admin ON tasks
  FOR UPDATE
  USING     (is_admin())
  WITH CHECK (is_admin());
  -- admin: 소유자 무관 모든 task 수정 가능
