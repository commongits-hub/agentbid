-- Migration 014: custom_access_token_hook — claims.role 오버라이드 제거
--
-- 문제: migration 007 + 013에서 claims.role에 앱 역할('user'/'provider'/'admin')을 삽입함
-- PostgREST는 JWT claims.role을 PostgreSQL 데이터베이스 롤로 해석하므로
-- 'user' 롤이 DB에 없어 "role \"user\" does not exist" 에러 발생
-- → RLS 정책 전혀 동작 안 함 (follows, reviews 등 모든 authenticated 동작 불가)
--
-- 수정 내용:
--   - claims.role 오버라이드 라인 완전 제거
--   - claims.app_metadata.app_role + claims.app_metadata.is_active 유지
--   - JWT role은 Supabase Auth가 자동 설정하는 'authenticated'/'anon' 그대로 유지

CREATE OR REPLACE FUNCTION custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  claims        jsonb;
  v_role        text;
  v_active      boolean;
  v_app_meta    jsonb;
BEGIN
  -- public.users에서 role, is_active 조회
  SELECT role::text, is_active
  INTO v_role, v_active
  FROM public.users
  WHERE id = (event->>'user_id')::uuid;

  claims     := event->'claims';
  v_app_meta := COALESCE(claims->'app_metadata', '{}'::jsonb);

  -- app_metadata.app_role 삽입 (requireAuth() 권한 원본 경로)
  v_app_meta := jsonb_set(v_app_meta, '{app_role}', to_jsonb(COALESCE(v_role, 'user')));

  -- app_metadata.is_active 삽입
  v_app_meta := jsonb_set(v_app_meta, '{is_active}', to_jsonb(COALESCE(v_active, true)));

  claims := jsonb_set(claims, '{app_metadata}', v_app_meta);

  -- ⚠️ claims.role은 절대 오버라이드하지 않음
  -- PostgREST가 claims.role을 PostgreSQL DB 롤로 사용하며
  -- Supabase는 자동으로 'authenticated' / 'anon'을 삽입함
  -- 'user', 'provider', 'admin' 등 앱 역할을 여기 넣으면 롤 없음 에러 발생

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

GRANT EXECUTE ON FUNCTION custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION custom_access_token_hook FROM authenticated, anon, public;
