-- ============================================================
-- Migration 026: Storage RLS 정책 — submissions 직접 쿼리 → SECURITY DEFINER 함수 교체
-- Author: commongits-hub
-- 수정 사유:
--   migration 024의 REVOKE SELECT ON submissions FROM authenticated 이후
--   Storage RLS 정책(sub_files_upload, sub_files_delete, task_att_select)이
--   submissions 테이블을 직접 쿼리하므로 authenticated 컨텍스트에서 실패.
--   → provider 파일 업로드 / 삭제 / task 첨부파일 조회 전부 broken.
--
-- 수정 방향:
--   SECURITY DEFINER 헬퍼 함수 3개 생성:
--     1. storage_check_submission_provider(uuid)
--        provider가 해당 submission 소유자인지 확인
--        (sub_files_upload 전용)
--     2. storage_check_submission_provider_open_task(uuid)
--        provider가 해당 submission 소유자 + task가 open 상태인지 확인
--        (sub_files_delete 전용)
--     3. storage_check_provider_for_task(uuid)
--        provider가 해당 task에 submission을 제출했는지 확인
--        (task_att_select 전용)
--   Storage 정책 재정의: EXISTS(...FROM submissions) → 함수 호출
--
-- 보안:
--   SECURITY DEFINER 함수는 postgres 권한으로 submissions에 접근.
--   함수 내부에서 auth.uid()로 caller를 검증 → 권한 상승 없음.
--   GRANT: authenticated에만 EXECUTE 허용.
--   REVOKE: anon, public에서 차단.
-- ============================================================

-- ============================================================
-- 1. SECURITY DEFINER 헬퍼 함수
-- ============================================================

-- 1a. storage_check_submission_provider(p_submission_id uuid)
--     provider가 해당 submission의 소유 agent인지 확인
--     → sub_files_upload 정책 전용
CREATE OR REPLACE FUNCTION storage_check_submission_provider(p_submission_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   submissions s
    JOIN   agents      a ON a.id = s.agent_id
    WHERE  s.id             = p_submission_id
      AND  a.user_id        = auth.uid()
      AND  s.soft_deleted_at IS NULL
  );
$$;

GRANT   EXECUTE ON FUNCTION storage_check_submission_provider(uuid) TO authenticated;
REVOKE  EXECUTE ON FUNCTION storage_check_submission_provider(uuid) FROM anon, public;

COMMENT ON FUNCTION storage_check_submission_provider(uuid) IS
  'Storage RLS 전용: provider가 해당 submission 소유자인지 확인. '
  'SECURITY DEFINER — auth.uid()로 caller 검증, submissions 직접 접근 대체.';

-- 1b. storage_check_submission_provider_open_task(p_submission_id uuid)
--     provider가 해당 submission 소유자 + task가 open 상태인지 확인
--     → sub_files_delete 정책 전용
CREATE OR REPLACE FUNCTION storage_check_submission_provider_open_task(p_submission_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   submissions s
    JOIN   agents      a ON a.id = s.agent_id
    JOIN   tasks       t ON t.id = s.task_id
    WHERE  s.id             = p_submission_id
      AND  a.user_id        = auth.uid()
      AND  t.status         = 'open'
      AND  s.soft_deleted_at IS NULL
  );
$$;

GRANT   EXECUTE ON FUNCTION storage_check_submission_provider_open_task(uuid) TO authenticated;
REVOKE  EXECUTE ON FUNCTION storage_check_submission_provider_open_task(uuid) FROM anon, public;

COMMENT ON FUNCTION storage_check_submission_provider_open_task(uuid) IS
  'Storage RLS 전용: provider가 submission 소유자 + task=open인지 확인. '
  'SECURITY DEFINER — sub_files_delete 정책에서 submissions 직접 접근 대체.';

-- 1c. storage_check_provider_for_task(p_task_id uuid)
--     provider가 해당 task에 submission을 제출했는지 확인
--     → task_att_select 정책 전용
CREATE OR REPLACE FUNCTION storage_check_provider_for_task(p_task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   submissions s
    JOIN   agents      a ON a.id = s.agent_id
    WHERE  s.task_id        = p_task_id
      AND  a.user_id        = auth.uid()
      AND  s.soft_deleted_at IS NULL
  );
$$;

GRANT   EXECUTE ON FUNCTION storage_check_provider_for_task(uuid) TO authenticated;
REVOKE  EXECUTE ON FUNCTION storage_check_provider_for_task(uuid) FROM anon, public;

COMMENT ON FUNCTION storage_check_provider_for_task(uuid) IS
  'Storage RLS 전용: provider가 해당 task에 submission을 제출했는지 확인. '
  'SECURITY DEFINER — task_att_select 정책에서 submissions 직접 접근 대체.';

-- ============================================================
-- 2. Storage 정책 재정의
--    EXISTS(...FROM submissions) → SECURITY DEFINER 함수 호출
-- ============================================================

-- 2a. sub_files_upload: provider 본인만 업로드
--     storage_check_submission_provider() 사용
DROP POLICY IF EXISTS sub_files_upload ON storage.objects;
CREATE POLICY sub_files_upload ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'submission-files'
    AND (storage.foldername(name))[1] = 'submissions'
    AND storage_check_submission_provider(
          (storage.foldername(name))[2]::uuid
        )
  );

-- 2b. sub_files_delete: provider 본인 + task open 상태만 삭제
--     storage_check_submission_provider_open_task() 사용
DROP POLICY IF EXISTS sub_files_delete ON storage.objects;
CREATE POLICY sub_files_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'submission-files'
    AND (storage.foldername(name))[1] = 'submissions'
    AND storage_check_submission_provider_open_task(
          (storage.foldername(name))[2]::uuid
        )
  );

-- 2c. task_att_select: task 소유자 + 제출한 provider + admin
--     storage_check_provider_for_task() 사용
DROP POLICY IF EXISTS task_att_select ON storage.objects;
CREATE POLICY task_att_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'task-attachments'
    AND (
      EXISTS (
        SELECT 1 FROM tasks t
        WHERE t.id::text = (storage.foldername(name))[2]
          AND t.user_id  = auth.uid()
      )
      OR storage_check_provider_for_task(
           (storage.foldername(name))[2]::uuid
         )
      OR (SELECT is_admin())
    )
  );
