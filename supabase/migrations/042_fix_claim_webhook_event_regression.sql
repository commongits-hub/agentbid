-- ============================================================
-- Migration 042: claim_webhook_event() 037 버그 수정 + 022 보강 재통합
--
-- 문제 (037 회귀):
--   037이 SECURITY DEFINER / search_path / REVOKE 추가를 의도했으나
--   두 가지 버그 포함:
--     1) 컬럼명 오기: event_type → 실제 스키마 컬럼은 type
--        → 037 적용 시 INSERT 런타임 오류 발생
--     2) 022 보강 소실:
--        - processing_started_at 세팅 제거됨
--        - type mismatch 감지 로직 제거됨
--
-- 해결:
--   022 기능 전체 + 037 의도(SECURITY DEFINER / search_path / REVOKE) 결합
--   037 버그(컬럼명 오기, 보강 소실) 제거
--
-- 최종 함수 기준: 022 로직 + 037 권한 강화
-- ============================================================

CREATE OR REPLACE FUNCTION claim_webhook_event(p_id text, p_type text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claimed       integer := 0;
  v_existing_type text;
BEGIN
  -- ── type 불일치 감지 (022 보강 복원) ─────────────────────────────────────
  -- 동일 event_id에 서로 다른 type: Stripe 이상 데이터 또는 의도치 않은 재처리
  SELECT type INTO v_existing_type
  FROM public.stripe_webhook_events
  WHERE id = p_id;

  IF FOUND AND v_existing_type IS DISTINCT FROM p_type THEN
    RAISE WARNING
      'claim_webhook_event: type mismatch for event_id=% (stored=%, incoming=%). Rejecting.',
      p_id, v_existing_type, p_type;
    RETURN false;
  END IF;

  -- ── Atomic claim ──────────────────────────────────────────────────────────
  -- 컬럼명: type (스키마 기준 — 037의 event_type 오기 수정)
  -- processing_started_at = now() (022 보강 복원)
  INSERT INTO public.stripe_webhook_events(
    id, type, processed, processing, processing_started_at
  )
  VALUES (p_id, p_type, false, true, now())
  ON CONFLICT (id) DO UPDATE
    SET
      processing            = true,
      processing_started_at = now()
    WHERE public.stripe_webhook_events.processed  = false
      AND public.stripe_webhook_events.processing = false;

  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  RETURN v_claimed > 0;
END;
$$;

-- service_role 전용 (webhook API 서버 경로)
GRANT   EXECUTE ON FUNCTION claim_webhook_event(text, text) TO service_role;
REVOKE  EXECUTE ON FUNCTION claim_webhook_event(text, text) FROM authenticated;
REVOKE  EXECUTE ON FUNCTION claim_webhook_event(text, text) FROM anon;
REVOKE  EXECUTE ON FUNCTION claim_webhook_event(text, text) FROM PUBLIC;
