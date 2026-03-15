-- ============================================================
-- Migration 034: custom_access_token_hook search_path 보강
--                + cron schedule idempotency 수정
--                + Edge Function cron 주석 현행화
--
-- 해소 항목:
--   007의 custom_access_token_hook — SET search_path 없음
--   007의 cron.schedule — 재실행 시 중복 에러 가능 (non-idempotent)
--   007의 Edge Function cron 예시 주석 — service_role bearer 기준, 현재 CRON_SECRET 방식과 불일치
--
-- 이미 해소된 항목 (재작업 불필요):
--   claims.role 오염 → 014에서 제거됨
--   app_metadata.app_role 미주입 → 013에서 삽입됨
-- ============================================================

-- ------------------------------------------------------------
-- [1] custom_access_token_hook: SET search_path = public 추가
--     014 기준 함수 본체 유지, LANGUAGE 선언만 보강
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

GRANT EXECUTE ON FUNCTION custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION custom_access_token_hook FROM authenticated, anon, public;

-- ------------------------------------------------------------
-- [2] cron schedule idempotency 보강
--     close-expired-tasks / release-matured-payouts
--     007에서 raw SELECT cron.schedule(...)로 등록됨 → 재실행 시 중복 에러 가능
--     unschedule 후 재등록으로 idempotent하게 변경
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'close-expired-tasks') THEN
    PERFORM cron.unschedule('close-expired-tasks');
  END IF;
END $$;

SELECT cron.schedule(
  'close-expired-tasks',
  '0 * * * *',  -- 매시 정각
  $$SELECT close_expired_tasks();$$
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'release-matured-payouts') THEN
    PERFORM cron.unschedule('release-matured-payouts');
  END IF;
END $$;

SELECT cron.schedule(
  'release-matured-payouts',
  '0 2 * * *',  -- 매일 오전 2시 (UTC)
  $$SELECT release_matured_payouts();$$
);

-- ------------------------------------------------------------
-- [3] transfer-payouts cron 호출 방식 주석 현행화
--     CRON_SECRET 헤더 방식으로 변경됨 (migration 031 참조)
--     service_role bearer 방식은 deprecated
-- ------------------------------------------------------------
COMMENT ON FUNCTION custom_access_token_hook IS
  'JWT access token hook. '
  'app_metadata.app_role + app_metadata.is_active 삽입. '
  'claims.role은 오버라이드하지 않음 (PostgREST DB 롤 충돌 방지). '
  '참조: migration 013(app_metadata 추가), 014(claims.role 오버라이드 제거).';
