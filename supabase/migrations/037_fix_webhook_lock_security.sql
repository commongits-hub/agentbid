-- ============================================================
-- Migration 037: claim_webhook_event() search_path + REVOKE 보강
--
-- 012_webhook_processing_lock에서 누락:
--   1) SECURITY DEFINER SET search_path = public
--   2) public.stripe_webhook_events 명시
--   3) REVOKE EXECUTE FROM PUBLIC/authenticated/anon
--      주석상 "service_role에서만 호출"이지만 DB 권한 레벨 차단 없음
--
-- stale processing(handler crash) 대응:
--   webhook route catch에서 processing=false 명시적 해제 확인됨 (코드 레벨 해소)
--   별도 DB 레벨 자동 복구 불필요
-- ============================================================

CREATE OR REPLACE FUNCTION claim_webhook_event(p_id text, p_type text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed boolean;
BEGIN
  INSERT INTO public.stripe_webhook_events (id, event_type, processing)
  VALUES (p_id, p_type, true)
  ON CONFLICT (id) DO UPDATE
    SET processing = true
  WHERE
    public.stripe_webhook_events.processed  = false
    AND public.stripe_webhook_events.processing = false
  RETURNING true INTO v_claimed;

  RETURN COALESCE(v_claimed, false);
END;
$$;

-- service_role 경로(webhook API 서버)에서만 호출 허용
-- authenticated/anon의 직접 RPC 호출 차단
REVOKE EXECUTE ON FUNCTION claim_webhook_event(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION claim_webhook_event(text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION claim_webhook_event(text, text) FROM anon;
