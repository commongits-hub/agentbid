-- ============================================================
-- Migration 040: cancel_payout_on_refund() SECURITY DEFINER 보강
--
-- 해소 항목 (021 리뷰 잔여 1건):
--   - cancel_payout_on_refund()가 021에서 재정의됐으나 SECURITY DEFINER 누락
--   - 030에서 다른 trigger 함수들(update_rating_stats, update_follower_count,
--     auto_flag_on_reports, cancel_payout_on_refund 계열)은 보강됐으나
--     이 함수만 빠진 상태로 chain 끝까지 유지됨
--
-- 배경:
--   - cancel_payout_on_refund()는 orders AFTER UPDATE 트리거
--     (trg_cancel_payout_on_refund)로만 호출됨
--   - 실행 경로: webhook(service_role) → orders UPDATE → trigger
--   - service_role 컨텍스트에서는 runtime 위험 낮음
--   - 단, 030 이후 trigger 함수 전체가 SECURITY DEFINER 기준으로 통일됐으므로
--     일관성 및 방어적 보강 목적으로 040에서 완결
--
-- 적용 내용:
--   1) SECURITY DEFINER 추가
--   2) SET search_path = public, pg_temp (기존 유지 + 명시 강화)
--   3) public.payouts 명시적 qualification
--   4) REVOKE EXECUTE FROM PUBLIC (trigger 전용 함수 — direct invocation 차단)
--
-- 함수 본체: 021 기준 그대로 유지 (hold/pending/released → cancelled, hold_reason NULL)
-- ============================================================

CREATE OR REPLACE FUNCTION cancel_payout_on_refund()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'refunded' AND OLD.status != 'refunded' THEN

    -- pending / released → cancelled
    UPDATE public.payouts
    SET
      status      = 'cancelled',
      hold_reason = NULL        -- 방어적 초기화 (비hold 상태이므로 NULL이어야 함)
    WHERE order_id = NEW.id
      AND status IN ('pending', 'released');

    -- hold → cancelled (환불 시 hold payout 정리)
    -- hold_reason 반드시 NULL로 초기화:
    -- prevent_payout_core_change의 hold_reason 정합성 검증 통과 위해 필수
    UPDATE public.payouts
    SET
      status      = 'cancelled',
      hold_reason = NULL
    WHERE order_id = NEW.id
      AND status = 'hold';

    -- transferred: 취소 불가 (이미 출금됨 — 별도 회수 프로세스 필요)
    -- 의도적으로 건드리지 않음

  END IF;
  RETURN NEW;
END;
$$;

-- trigger 전용 함수 — direct invocation 차단
REVOKE EXECUTE ON FUNCTION cancel_payout_on_refund() FROM PUBLIC;
