-- ============================================================
-- Migration 033: 006_rls_policies 정책 의도 명시
-- 구조/RLS 변경 없음 — COMMENT 추가만
-- ============================================================

-- ------------------------------------------------------------
-- fee_policies: append-only 운영 정책 명시
--   수수료 이력은 감사 추적 목적으로 과거 row 수정 불허
--   새 정책 추가 시 INSERT만 사용 (UPDATE 정책은 의도적으로 없음)
-- ------------------------------------------------------------
COMMENT ON TABLE fee_policies IS
  'append-only 운영. 새 수수료 정책은 INSERT로만 추가. '
  'UPDATE 정책 없음 — 과거 이력 수정 불허 (감사 추적 목적).';

-- ------------------------------------------------------------
-- task_attachments: 접근 범위 의도 명시
--   task owner / admin / 해당 task에 실제 제출한 provider 조회 허용
--   selected provider 한정 강화는 다음 데이터 모델 라운드에서 재검토
-- ------------------------------------------------------------
COMMENT ON TABLE task_attachments IS
  'RLS: task owner / admin / 해당 task에 제출한 provider(soft_deleted_at IS NULL) 조회 가능. '
  'selected provider 한정 강화는 보류 — 서비스 접근성 우선. '
  '재검토 시점: 다음 데이터 모델 라운드.';
