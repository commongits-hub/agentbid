-- ============================================================
-- Migration 017: RLS Hardening Phase 2 + trigger hardening
-- Author: commongits-hub
-- 수정 항목:
--   1. get_user_role() — 허용값 allowlist, 알 수 없는 값 → 'user' fallback
--   2. prevent_user_privilege_escalation() — 조용한 무시 → RAISE EXCEPTION
--   3. prevent_submission_manipulation() — 잠금 컬럼 확대
--   4. reviews_insert — 자기 자신 리뷰 차단 + paid 상태만 허용
--   5. reviews_select — flagged 비공개 (published + admin만 공개)
--   6. claim_webhook_event() — SET search_path 추가
--   7. custom_access_token_hook() — claims.role 오버라이드 완전 제거 확인
--      (migration 014 적용됐으나 013에 잔재가 남아있어 명시적 재확인 재배포)
-- ============================================================

-- ============================================================
-- 1. get_user_role() — allowlist 방어 추가
--    허용값: 'user', 'provider', 'admin'
--    알 수 없는 값이 app_metadata에 들어오면 'user'로 fallback
-- ============================================================
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS text AS $$
DECLARE
  v_role text;
BEGIN
  v_role := auth.jwt()->'app_metadata'->>'app_role';
  -- allowlist: 알 수 없는 값은 최소 권한(user)으로 fallback
  IF v_role NOT IN ('user', 'provider', 'admin') THEN
    RETURN 'user';
  END IF;
  RETURN v_role;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

-- is_admin도 재배포 (search_path 고정 유지)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
  SELECT get_user_role() = 'admin';
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

-- get_my_agent_id도 재배포 (search_path 고정 유지)
CREATE OR REPLACE FUNCTION get_my_agent_id()
RETURNS uuid AS $$
  SELECT id FROM public.agents
  WHERE user_id = auth.uid()
    AND soft_deleted_at IS NULL
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

-- ============================================================
-- 2. prevent_user_privilege_escalation() — RAISE EXCEPTION으로 변경
--    조용한 복원(OLD 값 덮어씌우기) 대신 명시적 에러로 실패 처리
--    클라이언트에서 에러 응답으로 의도가 명확하게 전달됨
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_user_privilege_escalation()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT is_admin() THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Permission denied: cannot change your own role (current: %, attempted: %)',
        OLD.role, NEW.role
        USING ERRCODE = '42501';  -- insufficient_privilege
    END IF;
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      RAISE EXCEPTION 'Permission denied: cannot change is_active status'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ============================================================
-- 3. prevent_submission_manipulation() — 잠금 컬럼 확대
--    provider가 변경 불가한 컬럼:
--      task_id, agent_id, status, quoted_price,
--      selected_at, delivered_at, approved_at, soft_deleted_at
--    provider가 변경 가능한 컬럼(명시적 허용):
--      preview_text, preview_thumbnail_url, content_text, file_path
--    admin은 모든 컬럼 변경 가능
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_submission_manipulation()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT is_admin() THEN
    -- 잠금 컬럼: 변경 시도 시 RAISE EXCEPTION
    IF NEW.task_id        IS DISTINCT FROM OLD.task_id         THEN
      RAISE EXCEPTION 'Cannot change task_id on submission' USING ERRCODE = '42501';
    END IF;
    IF NEW.agent_id       IS DISTINCT FROM OLD.agent_id        THEN
      RAISE EXCEPTION 'Cannot change agent_id on submission' USING ERRCODE = '42501';
    END IF;
    IF NEW.status         IS DISTINCT FROM OLD.status          THEN
      RAISE EXCEPTION 'Cannot change submission status directly (current: %, attempted: %)',
        OLD.status, NEW.status
        USING ERRCODE = '42501';
    END IF;
    IF NEW.quoted_price   IS DISTINCT FROM OLD.quoted_price    THEN
      RAISE EXCEPTION 'Cannot change quoted_price on submission' USING ERRCODE = '42501';
    END IF;
    IF NEW.selected_at    IS DISTINCT FROM OLD.selected_at     THEN
      RAISE EXCEPTION 'Cannot change selected_at on submission' USING ERRCODE = '42501';
    END IF;
    IF NEW.delivered_at   IS DISTINCT FROM OLD.delivered_at    THEN
      RAISE EXCEPTION 'Cannot change delivered_at on submission' USING ERRCODE = '42501';
    END IF;
    IF NEW.approved_at    IS DISTINCT FROM OLD.approved_at     THEN
      RAISE EXCEPTION 'Cannot change approved_at on submission' USING ERRCODE = '42501';
    END IF;
    IF NEW.soft_deleted_at IS DISTINCT FROM OLD.soft_deleted_at THEN
      RAISE EXCEPTION 'Cannot change soft_deleted_at on submission' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ============================================================
-- 4. reviews_select — flagged 비공개 (published + admin만)
--    flagged = 운영 검토 중 → 공개 부적절, admin만 확인 가능
-- ============================================================
DROP POLICY IF EXISTS reviews_select ON reviews;
CREATE POLICY reviews_select ON reviews
  FOR SELECT USING (
    status = 'published'
    OR is_admin()
  );

-- ============================================================
-- 5. reviews_insert — 자기 자신 리뷰 차단 + 상태 검증 강화
--    - agent 소유자가 자기 자신에게 리뷰 불가
--    - order.status = 'paid'만 허용 (cancelled/refunded/disputed 제외)
-- ============================================================
DROP POLICY IF EXISTS reviews_insert ON reviews;
CREATE POLICY reviews_insert ON reviews
  FOR INSERT WITH CHECK (
    -- 본인 uid
    user_id = auth.uid()
    -- provider가 아닌 user만 리뷰 작성 가능
    AND get_user_role() = 'user'
    -- paid 주문 존재 확인 (오직 'paid' 상태만 — cancelled/refunded 제외)
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id        = order_id
        AND o.user_id   = auth.uid()
        AND o.status    = 'paid'
    )
    -- 자기 자신 리뷰 차단
    -- (order → submission → agent → user가 리뷰 작성자인 경우 차단)
    AND NOT EXISTS (
      SELECT 1
      FROM orders o
      JOIN submissions s ON s.id = o.submission_id
      JOIN agents a ON a.id = s.agent_id
      WHERE o.id = order_id
        AND a.user_id = auth.uid()
    )
  );

-- ============================================================
-- 6. claim_webhook_event() — SET search_path 추가
-- ============================================================
CREATE OR REPLACE FUNCTION claim_webhook_event(p_id text, p_type text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claimed integer := 0;
BEGIN
  INSERT INTO stripe_webhook_events(id, type, processed, processing)
  VALUES (p_id, p_type, false, true)
  ON CONFLICT (id) DO UPDATE
    SET processing = true
    WHERE stripe_webhook_events.processed = false
      AND stripe_webhook_events.processing = false;

  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  RETURN v_claimed > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_webhook_event(text, text) TO service_role;

-- ============================================================
-- 7. custom_access_token_hook() — claims.role 오버라이드 완전 제거
--    migration 013에서 잔재로 남아있던 claims.role 설정 라인이
--    migration 014에서 제거됐으나, 최종 상태를 명시적으로 재확인 배포
-- ============================================================
CREATE OR REPLACE FUNCTION custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  claims        jsonb;
  v_role        text;
  v_active      boolean;
  v_app_meta    jsonb;
BEGIN
  SELECT role::text, is_active
  INTO v_role, v_active
  FROM public.users
  WHERE id = (event->>'user_id')::uuid;

  claims     := event->'claims';
  v_app_meta := COALESCE(claims->'app_metadata', '{}'::jsonb);

  -- app_role: allowlist 검증 후 삽입
  IF v_role NOT IN ('user', 'provider', 'admin') OR v_role IS NULL THEN
    v_role := 'user';
  END IF;
  v_app_meta := jsonb_set(v_app_meta, '{app_role}', to_jsonb(v_role));

  -- is_active
  v_app_meta := jsonb_set(v_app_meta, '{is_active}', to_jsonb(COALESCE(v_active, true)));
  claims     := jsonb_set(claims, '{app_metadata}', v_app_meta);

  -- ⚠️ claims.role 오버라이드 없음
  -- PostgREST는 claims.role을 PostgreSQL 롤로 해석 ('authenticated'/'anon')
  -- 앱 역할은 app_metadata.app_role에만 기록

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

GRANT EXECUTE ON FUNCTION custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION custom_access_token_hook FROM authenticated, anon, public;
