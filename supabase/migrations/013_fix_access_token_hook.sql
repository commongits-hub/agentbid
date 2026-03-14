-- Migration 013: custom_access_token_hook — app_metadata.app_role 삽입
-- 기존 hook은 claims.role(top-level JWT role)만 설정했으나
-- requireAuth()는 app_metadata.app_role을 읽음 → role 감지 불가 버그 수정
--
-- 변경 내용:
--   - claims.app_metadata.app_role 추가 (requireAuth() 원본 경로)
--   - claims.role 유지 (PostgREST 호환, 기존 동작 보존)
-- 목표: app_metadata.app_role이 권한 원본이 되면 user_metadata.role fallback 제거 가능

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

  -- app_metadata.app_role 삽입 (requireAuth() 원본 경로)
  v_app_meta := jsonb_set(v_app_meta, '{app_role}', to_jsonb(COALESCE(v_role, 'user')));
  claims     := jsonb_set(claims, '{app_metadata}', v_app_meta);

  -- claims.role 유지 (기존 동작 보존 — 점진적 마이그레이션용 fallback)
  claims := jsonb_set(claims, '{role}', to_jsonb(COALESCE(v_role, 'user')));

  -- is_active claim 삽입
  IF v_active = false THEN
    claims := jsonb_set(claims, '{is_active}', 'false'::jsonb);
  ELSE
    claims := jsonb_set(claims, '{is_active}', 'true'::jsonb);
  END IF;

  -- app_metadata.is_active도 삽입 (requireAuth() 읽기 경로)
  v_app_meta := claims->'app_metadata';
  v_app_meta := jsonb_set(v_app_meta, '{is_active}', to_jsonb(COALESCE(v_active, true)));
  claims     := jsonb_set(claims, '{app_metadata}', v_app_meta);

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

GRANT EXECUTE ON FUNCTION custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION custom_access_token_hook FROM authenticated, anon, public;
