-- ============================================================
-- Migration 029: orders.submission_id one-time purchase 정책 명시
-- 정책: 같은 submission은 평생 1회 구매만 허용
--   - submission_id UNIQUE 제약 유지 (004에서 설정)
--   - cancelled/refunded 후 재주문은 지원하지 않음
--   - 재구매 확장 시 별도 설계 필요 (submission.status 복원, 원본 접근 재차단 포함)
-- ============================================================

-- orders.submission_id unique 의도 명시 (컬럼 코멘트)
COMMENT ON COLUMN orders.submission_id IS
  'submission당 1회 구매만 허용. UNIQUE 제약은 정책적 의도임. '
  '재구매 허용 시 별도 설계 필요 (refund 후 submission.status 복원 포함).';

-- orders 테이블 코멘트
COMMENT ON TABLE orders IS
  'task owner가 submission을 선택해 결제하는 주문 테이블. '
  '같은 submission에 대한 주문은 생애 1회로 제한됨 (submission_id UNIQUE).';
