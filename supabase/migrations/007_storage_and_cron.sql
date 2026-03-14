-- ============================================================
-- Migration 007: Storage 버킷 정책 / Cron 스케줄 / JWT Hook
-- Author: commongits-hub
-- Description: Storage RLS, 자동화 스케줄, JWT custom claim 설정
-- 선행: 006_rls_policies.sql
-- 주의: Supabase Dashboard에서 추가로 설정 필요한 항목은 주석으로 명시
-- ============================================================

-- ============================================================
-- Storage 버킷 생성
-- Supabase Dashboard > Storage에서 생성하거나 아래 SQL 실행
-- ============================================================

-- submission-files 버킷 (비공개, 서명 URL 전용)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'submission-files',
  'submission-files',
  false,
  104857600,  -- 100MB
  NULL        -- 모든 MIME 허용 (서버에서 추가 검증)
)
ON CONFLICT (id) DO NOTHING;

-- task-attachments 버킷 (비공개)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'task-attachments',
  'task-attachments',
  false,
  52428800,   -- 50MB
  NULL
)
ON CONFLICT (id) DO NOTHING;

-- avatars 버킷 (공개)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  5242880,    -- 5MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Storage RLS 정책
-- ============================================================

-- ------------------------------------------------------------
-- submission-files: 직접 SELECT 완전 차단
-- signed URL은 service_role_key로 서버에서만 발급
-- 주의: bucket_id != 'submission-files' 형태는 다른 버킷을 넓게 허용하는 부작용 있음
-- → bucket_id = 'submission-files' AND false 로 해당 버킷만 정확히 차단
-- ------------------------------------------------------------
CREATE POLICY sub_files_no_direct_read ON storage.objects
  FOR SELECT USING (
    bucket_id = 'submission-files' AND false
  );
-- false 조건으로 submission-files 버킷 SELECT 완전 차단
-- service_role_key는 RLS 우회 → API 서버에서만 signed URL 발급 가능
-- anon/authenticated role은 이 정책으로 직접 URL 접근 불가

-- submission-files: provider 본인만 업로드 허용
-- 경로 규칙: submissions/{submission_id}/{filename}
CREATE POLICY sub_files_upload ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'submission-files'
    AND (storage.foldername(name))[1] = 'submissions'
    AND EXISTS (
      SELECT 1 FROM submissions s
      JOIN agents a ON s.agent_id = a.id
      WHERE s.id::text = (storage.foldername(name))[2]
        AND a.user_id = auth.uid()
        AND s.soft_deleted_at IS NULL
    )
  );

-- submission-files: provider 본인만 삭제/교체 허용 (마감 전)
CREATE POLICY sub_files_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'submission-files'
    AND (storage.foldername(name))[1] = 'submissions'
    AND EXISTS (
      SELECT 1 FROM submissions s
      JOIN agents a ON s.agent_id = a.id
      JOIN tasks t ON s.task_id = t.id
      WHERE s.id::text = (storage.foldername(name))[2]
        AND a.user_id = auth.uid()
        AND t.status = 'open'       -- 마감 전만 삭제 허용
        AND s.soft_deleted_at IS NULL
    )
  );

-- ------------------------------------------------------------
-- task-attachments: task 소유자 업로드
-- 경로 규칙: tasks/{task_id}/{filename}
-- ------------------------------------------------------------
CREATE POLICY task_att_upload ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'task-attachments'
    AND (storage.foldername(name))[1] = 'tasks'
    AND EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id::text = (storage.foldername(name))[2]
        AND t.user_id = auth.uid()
        AND t.soft_deleted_at IS NULL
    )
  );

-- task-attachments: 소유자 + 제출한 provider 서명 URL 조회 허용
-- (이 정책은 서명 URL 발급 시 service_role이 우회하므로 일반 SELECT만 제어)
CREATE POLICY task_att_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'task-attachments'
    AND (
      EXISTS (
        SELECT 1 FROM tasks t
        WHERE t.id::text = (storage.foldername(name))[2]
          AND t.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM submissions s
        JOIN agents a ON s.agent_id = a.id
        WHERE s.task_id::text = (storage.foldername(name))[2]
          AND a.user_id = auth.uid()
          AND s.soft_deleted_at IS NULL
      )
      OR (SELECT is_admin())
    )
  );

-- ------------------------------------------------------------
-- avatars: 공개 버킷, 본인만 업로드
-- 경로 규칙: avatars/{user_id}/avatar.{ext}
-- ------------------------------------------------------------
CREATE POLICY avatars_upload ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = 'avatars'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY avatars_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- ============================================================
-- JWT Custom Claim Hook (Supabase Auth Hook)
-- Dashboard > Authentication > Hooks > Custom Access Token Hook
-- 아래 함수를 등록해야 JWT에 role claim이 포함됨
-- ============================================================
CREATE OR REPLACE FUNCTION custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  claims      jsonb;
  v_role      text;
  v_active    boolean;
BEGIN
  -- public.users에서 role, is_active 조회
  SELECT role::text, is_active
  INTO v_role, v_active
  FROM public.users
  WHERE id = (event->>'user_id')::uuid;

  claims := event->'claims';

  -- role claim 삽입
  claims := jsonb_set(claims, '{role}', to_jsonb(COALESCE(v_role, 'user')));

  -- is_active = false 이면 JWT에 is_active: false claim 삽입
  -- 실제 로그인 차단은 API middleware / RLS에서 처리
  -- RAISE EXCEPTION 방식은 Supabase Hook에서 불안정할 수 있어 사용 금지
  IF v_active = false THEN
    claims := jsonb_set(claims, '{is_active}', 'false'::jsonb);
  ELSE
    claims := jsonb_set(claims, '{is_active}', 'true'::jsonb);
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

-- ============================================================
-- 비활성 계정 차단 방식 안내
-- ============================================================
-- Hook에서 RAISE EXCEPTION 사용 금지 (Supabase Hook 불안정)
-- 대신 아래 2가지 레이어에서 차단:
--
-- [1] API middleware (Next.js middleware.ts):
--   const { data: { session } } = await supabase.auth.getSession()
--   const isActive = session?.user?.user_metadata?.is_active ?? true
--   if (!isActive) return NextResponse.redirect('/auth/deactivated')
--
-- [2] RLS: is_admin() 제외 전체 테이블에 아래 조건 추가 (선택적 강화)
--   AND (
--     SELECT is_active FROM public.users WHERE id = auth.uid()
--   ) = true

-- SECURITY DEFINER 함수는 public이 실행 가능해야 함
GRANT EXECUTE ON FUNCTION custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION custom_access_token_hook FROM authenticated, anon, public;

-- ============================================================
-- pg_cron 스케줄 등록
-- Supabase Dashboard > Database > Extensions에서 pg_cron 활성화 필요
-- ============================================================

-- pg_cron extension 활성화 (이미 활성화된 경우 무시)
CREATE EXTENSION IF NOT EXISTS pg_cron;
GRANT USAGE ON SCHEMA cron TO postgres;

-- 매시간 정각: 마감된 task 상태 전이 (open→reviewing, reviewing→expired)
SELECT cron.schedule(
  'close-expired-tasks',
  '0 * * * *',
  $$SELECT close_expired_tasks();$$
);

-- 매일 오전 2시: 정산 가능 payout 상태 전이 (pending→released)
SELECT cron.schedule(
  'release-matured-payouts',
  '0 2 * * *',
  $$SELECT release_matured_payouts();$$
);

-- ============================================================
-- Supabase Edge Function 연동 안내
-- (아래는 SQL이 아닌 배포 지침)
-- ============================================================
-- supabase/functions/transfer-payouts/index.ts 에서 구현:
--   매일 오전 3시 Edge Function 호출 (cron으로 trigger)
--   1. SELECT * FROM payouts WHERE status = 'released'
--   2. 각 payout의 agent.stripe_account_id로 Stripe Transfer 실행
--   3. 성공 시 payout.status = 'transferred', stripe_transfer_id 저장
--   4. 실패 시 payout.status = 'released' 유지 (재시도)
--   5. stripe_account_id IS NULL 이면 payout.status = 'hold'

-- cron으로 Edge Function 호출 등록
-- Supabase Dashboard > Edge Functions에서 HTTP 호출 cron 설정 또는:
-- SELECT cron.schedule(
--   'transfer-payouts-edge',
--   '0 3 * * *',
--   $$
--   SELECT net.http_post(
--     url := 'https://<project_ref>.supabase.co/functions/v1/transfer-payouts',
--     headers := '{"Authorization": "Bearer <service_role_key>"}'::jsonb
--   );
--   $$
-- );

-- ============================================================
-- 최종 확인 쿼리 (배포 후 실행 권장)
-- ============================================================
-- 1. enum 타입 확인
-- SELECT typname FROM pg_type WHERE typtype = 'e' ORDER BY typname;

-- 2. 테이블 목록 확인
-- SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

-- 3. RLS 활성화 확인
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public' AND rowsecurity = true;

-- 4. 인덱스 목록 확인
-- SELECT indexname, tablename FROM pg_indexes
-- WHERE schemaname = 'public' ORDER BY tablename, indexname;

-- 5. 트리거 목록 확인
-- SELECT trigger_name, event_object_table, action_timing, event_manipulation
-- FROM information_schema.triggers
-- WHERE trigger_schema = 'public' ORDER BY event_object_table;

-- 6. cron 스케줄 확인
-- SELECT jobname, schedule, command FROM cron.job;
