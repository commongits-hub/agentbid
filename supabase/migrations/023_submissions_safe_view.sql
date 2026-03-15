-- ============================================================
-- Migration 023: submissions_safe view — DB-level content masking
-- Author: commongits-hub
-- 수정 항목:
--   1. orders 복합 partial index 추가
--      (submissions_safe view의 EXISTS 서브쿼리 성능 최적화)
--   2. submissions_safe view 생성
--      - security_invoker = true → 기존 submissions RLS 그대로 적용
--      - LATERAL subquery로 can_see_full 1회 계산 → content 컬럼 마스킹
--      - content 공개 조건: is_admin() OR 본인 submission OR 구매 완료
--   3. authenticated GRANT
--      - submissions_safe: SELECT 허용
--      - submissions 직접 SELECT는 service_role 전용 (migration 024에서 차단 예정)
--
-- 배경:
--   현재 submissions_select RLS는 task owner / 본인 provider / admin에게
--   submissions 테이블의 모든 컬럼(content_text, file_path 등)을 허용함.
--   → 클라이언트가 supabase.from('submissions').select('*')를 직접 호출하면
--     미결제 submission의 content가 그대로 노출되는 구조적 리스크.
--   → API 레벨 shaping(2-query 분리)은 API 경로에서만 보호.
--   이 migration은 DB 레벨에서 컬럼 마스킹을 강제한다.
-- ============================================================

-- ============================================================
-- 1. orders 복합 partial index
--    submissions_safe view의 EXISTS 서브쿼리:
--      SELECT 1 FROM orders WHERE submission_id = ? AND user_id = ? AND status = 'paid'
--    이 조건에 최적화된 인덱스 (status='paid' 행만 포함)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_orders_submission_user_paid
  ON orders(submission_id, user_id)
  WHERE status = 'paid';

COMMENT ON INDEX idx_orders_submission_user_paid IS
  'submissions_safe view의 purchase gating EXISTS 서브쿼리 성능 최적화. '
  'status=paid 행만 partial index로 유지. '
  'submission_id + user_id 기준으로 구매 완료 여부를 빠르게 조회.';

-- ============================================================
-- 2. submissions_safe view
--
--    [접근 제어 레이어]
--    - Row-level:    security_invoker = true → submissions_select RLS 적용
--                    (task owner / 본인 provider / admin만 row 접근 가능)
--    - Column-level: CASE WHEN can_see_full 로 content 컬럼 마스킹
--                    (is_admin() OR 본인 submission OR 구매 완료만 실제값 반환)
--
--    [성능]
--    - CROSS JOIN LATERAL: can_see_full 계산을 row당 1회로 단축
--    - is_admin(), get_my_agent_id(): SECURITY DEFINER stable 함수, per-query 1회
--    - EXISTS: idx_orders_submission_user_paid 인덱스 사용
-- ============================================================
DROP VIEW IF EXISTS submissions_safe;

CREATE VIEW submissions_safe
  WITH (security_invoker = true)
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
  -- 미결제 + 타인 submission: NULL 반환 (서버 메모리에도 노출 안 됨)
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
    -- 본인이 제출한 submission: 본인 작성물이므로 전체 공개
    OR s.agent_id = get_my_agent_id()
    -- task owner가 구매 완료한 submission: 결제 확인 후 공개
    OR EXISTS (
      SELECT 1
      FROM   orders o
      WHERE  o.submission_id = s.id
        AND  o.user_id       = auth.uid()
        AND  o.status        = 'paid'
    )
  ) AS can_see_full
) AS access
-- soft_deleted는 view 레벨에서 필터링 (base table에도 partial index 적용됨)
WHERE s.soft_deleted_at IS NULL;

COMMENT ON VIEW submissions_safe IS
  '클라이언트 전용 submission 조회 view. '
  'content_text / file_path / file_name / file_size / mime_type는 '
  '구매 완료(orders.status=paid), 본인 submission, admin만 실제값 반환. '
  '미결제 타인 submission은 content 컬럼 전체 NULL. '
  '직접 submissions 테이블 SELECT는 service_role 전용. '
  'migration 024에서 authenticated의 submissions 직접 SELECT 차단 예정.';

-- ============================================================
-- 3. GRANT
--    authenticated: submissions_safe view를 통해서만 조회
--    anon: 조회 불가 (submissions RLS가 차단)
-- ============================================================
GRANT SELECT ON submissions_safe TO authenticated;

-- ============================================================
-- 주의사항 (migration 024 작업 전까지 유효)
-- ============================================================
-- authenticated 역할은 현재 submissions 테이블에도 직접 SELECT 가능.
-- 이는 기존 RLS(submissions_select)가 허용하기 때문.
-- 클라이언트 코드가 submissions_safe로 완전히 전환된 후
-- migration 024에서 다음을 실행할 예정:
--
--   REVOKE SELECT ON submissions FROM authenticated;
--   REVOKE SELECT ON submissions FROM anon;
--
-- 그 전까지: API 코드에서 반드시 submissions_safe를 사용해야 함.
-- service_role(supabaseAdmin)은 submissions 직접 접근 유지.
