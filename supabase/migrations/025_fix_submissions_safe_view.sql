-- ============================================================
-- Migration 025: submissions_safe view 재정의 — security_invoker → security_definer
-- Author: commongits-hub
-- 수정 사유:
--   migration 023에서 security_invoker = true를 사용했으나,
--   migration 024의 REVOKE로 authenticated/anon이 submissions에 접근 불가.
--   security_invoker view는 caller 권한으로 base table에 접근하므로
--   view 자체도 REVOKE에 의해 차단됨.
--
-- 수정 방향:
--   security_definer (기본값) 사용:
--   - view 소유자(postgres) 권한으로 base table 접근 → REVOKE 무관
--   - RLS는 view 내부 WHERE 절로 명시 재현 (submissions_select 동등)
--   - content 마스킹은 기존 LATERAL CASE WHEN 유지
--
-- view 내부 보안 구조:
--   [Row 필터]  WHERE 절에 RLS 동등 조건 명시
--               is_admin() OR task owner OR 본인 provider
--   [Column 필터] CASE WHEN can_see_full:
--               is_admin() OR 본인 submission OR 구매 완료
-- ============================================================

CREATE OR REPLACE VIEW submissions_safe
  -- security_definer (기본값): view 소유자 권한으로 base table 접근
  -- auth.uid() / is_admin() / get_my_agent_id()는 caller 컨텍스트 그대로 사용
AS
SELECT
  s.id,
  s.task_id,
  s.agent_id,
  s.status,
  s.quoted_price,
  s.preview_text,
  s.preview_thumbnail_url,
  -- content 컬럼: 구매 완료 OR 본인 submission OR admin만 실제값 반환
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
  -- security_definer view는 base table RLS를 자동 적용하지 않으므로 명시 재현
  -- 조건: admin OR task 소유자 OR 본인 provider
  AND (
    is_admin()
    OR s.task_id IN (SELECT id FROM tasks WHERE user_id = auth.uid())
    OR s.agent_id = get_my_agent_id()
  );

COMMENT ON VIEW submissions_safe IS
  '클라이언트 전용 submission 조회 view (security_definer). '
  'Row 필터: admin OR task 소유자 OR 본인 provider. '
  'Column 필터: content_text/file_path/file_name/file_size/mime_type → '
  '구매 완료(orders.status=paid) / 본인 submission / admin만 실제값 반환. '
  '직접 submissions 테이블 SELECT는 service_role 전용 (migration 024). '
  'authenticated 역할은 이 view를 통해서만 접근.';

-- GRANT는 migration 023에서 이미 적용됨 (GRANT SELECT ON submissions_safe TO authenticated)
-- 재확인 차원에서 명시
GRANT SELECT ON submissions_safe TO authenticated;
