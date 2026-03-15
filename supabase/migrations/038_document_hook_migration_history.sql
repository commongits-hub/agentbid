-- ============================================================
-- Migration 038: 013_fix_access_token_hook 이력 주석 명시
-- 구조 변경 없음 — 013이 잘못된 중간 단계임을 기록
--
-- 013의 문제:
--   1) claims.role에 앱 role('user'/'provider'/'admin') 삽입
--      → PostgREST가 claims.role을 DB role로 해석 → 'role "user" does not exist' 에러
--      → 이건 "기존 동작 보존"이 아니라 "기존 치명적 버그 유지"
--   2) SECURITY DEFINER SET search_path 없음
--   3) is_active를 top-level + app_metadata 양쪽에 중복 삽입
--
-- 해소 migration:
--   014 — claims.role 오버라이드 완전 제거, app_metadata.app_role/is_active 유지
--   034 — SET search_path = public 추가
--
-- 013은 "단독 배포 불가한 중간 이행 단계"로 기록
-- 014+034가 적용된 상태에서만 정상 동작 보장
-- ============================================================

COMMENT ON FUNCTION custom_access_token_hook IS
  'JWT access token hook (최신 상태: 034 기준). '
  '013은 claims.role 오염 포함한 중간 이행 단계 — 단독 배포 불가. '
  '014에서 claims.role 오버라이드 제거 완료. '
  '034에서 SET search_path = public 추가 완료. '
  '최종 구조: app_metadata.app_role + app_metadata.is_active만 삽입, claims.role 불변.';
