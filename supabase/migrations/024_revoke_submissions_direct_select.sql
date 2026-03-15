-- ============================================================
-- Migration 024: REVOKE SELECT ON submissions FROM authenticated / anon
-- Author: commongits-hub
-- 목적:
--   migration 023에서 submissions_safe view를 통한 DB-level 마스킹 완성.
--   이 migration은 authenticated / anon이 submissions 테이블을 직접
--   SELECT할 수 없도록 차단하여 마스킹 우회 경로를 완전히 제거한다.
--
-- 선행 확인 (완료):
--   - user JWT 경로에서 submissions 직접 select: 0건 (감사 완료, 2026-03-15)
--   - supabaseAdmin (service_role) 경로: 영향 없음 (REVOKE 대상 아님)
--   - 클라이언트 컴포넌트 직접 쿼리: 없음
--   - submissions_safe 전환 완료:
--       api/submissions/route.ts (user JWT 경로 전체)
--
-- REVOKE 대상:
--   - authenticated: JWT 인증 사용자 — submissions_safe 통해 접근
--   - anon:          비인증 접근 — submissions은 원래부터 RLS로 차단되나
--                    명시적 REVOKE로 이중 잠금
--
-- REVOKE 비대상 (영향 없음):
--   - service_role (supabaseAdmin): REVOKE 대상 아님, 직접 접근 유지
--   - postgres (내부 슈퍼유저): REVOKE 대상 아님
--
-- 롤백 방법 (긴급 복구):
--   GRANT SELECT ON submissions TO authenticated;
--   GRANT SELECT ON submissions TO anon;
-- ============================================================

-- ============================================================
-- 1. submissions 직접 SELECT 차단
--    authenticated: JWT 사용자 — submissions_safe 사용
--    anon:          비인증 — 이중 잠금
-- ============================================================
REVOKE SELECT ON submissions FROM authenticated;
REVOKE SELECT ON submissions FROM anon;

-- ============================================================
-- 2. submissions_safe는 유지 (authenticated SELECT 유지)
--    (migration 023에서 GRANT SELECT ON submissions_safe TO authenticated 완료)
-- ============================================================

-- ============================================================
-- 3. 검증용 쿼리 (적용 후 Supabase SQL Editor에서 직접 확인)
-- ============================================================
-- 아래 쿼리를 authenticated 역할로 실행하면 오류가 나야 함:
--   SELECT * FROM submissions LIMIT 1;
--   → ERROR: permission denied for table submissions
--
-- submissions_safe는 정상 조회돼야 함:
--   SELECT id, task_id, status FROM submissions_safe LIMIT 1;
--   → 정상 반환 (content 컬럼은 조건에 따라 NULL 또는 실제값)
--
-- service_role은 여전히 직접 접근 가능:
--   -- supabaseAdmin으로 실행
--   SELECT id FROM submissions LIMIT 1;
--   → 정상 반환
-- ============================================================

COMMENT ON TABLE submissions IS
  '⚠️ 직접 SELECT 제한: authenticated / anon은 접근 불가 (migration 024). '
  '클라이언트는 반드시 submissions_safe view를 통해 조회. '
  'service_role(supabaseAdmin) 전용 직접 접근. '
  '롤백: GRANT SELECT ON submissions TO authenticated;';
