-- ============================================================
-- Migration 041: submissions_safe view row filter 보강
--
-- 해소 항목 (025 리뷰 잔여 1건):
--   - submissions_safe WHERE 절의 task owner 조건에 soft_deleted_at IS NULL 누락
--   - soft-deleted task 소유자도 해당 task의 submission row를 볼 수 있는 상태
--   - 기존 tasks_select RLS (soft_deleted_at IS NULL 필터 포함)와 불일치
--
-- 수정 내용:
--   task owner 서브쿼리에 soft_deleted_at IS NULL 추가:
--     기존: SELECT id FROM tasks WHERE user_id = auth.uid()
--     수정: SELECT id FROM tasks WHERE user_id = auth.uid() AND soft_deleted_at IS NULL
--
-- 나머지 view 구조 (security_definer, column masking, LATERAL can_see_full):
--   025 기준 그대로 유지
-- ============================================================

CREATE OR REPLACE VIEW submissions_safe
  -- security_definer (기본값): view 소유자(postgres) 권한으로 base table 접근
  -- auth.uid() / is_admin() / get_my_agent_id(): caller 컨텍스트 그대로 사용
AS
SELECT
  s.id,
  s.task_id,
  s.agent_id,
  s.status,
  s.quoted_price,
  s.preview_text,
  s.preview_thumbnail_url,
  -- content 컬럼: 구매 완료 OR 본인 submission OR admin만 실제값
  CASE WHEN access.can_see_full THEN s.content_text ELSE NULL END AS content_text,
  CASE WHEN access.can_see_full THEN s.file_path    ELSE NULL END AS file_path,
  CASE WHEN access.can_see_full THEN s.file_name    ELSE NULL END AS file_name,
  CASE WHEN access.can_see_full THEN s.file_size    ELSE NULL END AS file_size,
  CASE WHEN access.can_see_full THEN s.mime_type    ELSE NULL END AS mime_type,
  s.created_at,
  s.updated_at
FROM submissions s
CROSS JOIN LATERAL (
  SELECT (
    is_admin()
    OR s.agent_id = get_my_agent_id()
    OR EXISTS (
      SELECT 1
      FROM   orders o
      WHERE  o.submission_id = s.id
        AND  o.user_id       = auth.uid()
        AND  o.status        = 'paid'
    )
  ) AS can_see_full
) AS access
WHERE s.soft_deleted_at IS NULL
  -- ── Row-level 필터: submissions_select RLS 동등 조건 ──────────────────────
  AND (
    is_admin()
    -- task owner: soft_deleted task는 제외 (tasks_select RLS와 동일 기준)
    OR s.task_id IN (
      SELECT id FROM tasks
      WHERE  user_id        = auth.uid()
        AND  soft_deleted_at IS NULL   -- 025 누락 항목 보강
    )
    OR s.agent_id = get_my_agent_id()
  );

COMMENT ON VIEW submissions_safe IS
  '클라이언트 전용 submission 조회 view (security_definer). '
  'Row 필터: admin OR task 소유자(soft_deleted 제외) OR 본인 provider. '
  'Column 필터: content_text/file_path/file_name/file_size/mime_type → '
  '구매 완료(orders.status=paid) / 본인 submission / admin만 실제값 반환. '
  '직접 submissions 테이블 SELECT는 service_role 전용 (migration 024). '
  '참조: 025(security_definer 전환), 041(soft_deleted task owner 보강).';

-- GRANT 재확인 (023/025에서 이미 적용, 명시적 유지)
GRANT SELECT ON submissions_safe TO authenticated;
