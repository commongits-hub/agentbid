-- ============================================================
-- Migration 022: webhook processing lock hardening
-- Author: commongits-hub
-- 수정 항목:
--   1. stripe_webhook_events.processing_started_at 컬럼 추가
--      (언제 claim 됐는지 추적 — stale lock 감지 기준)
--   2. claim_webhook_event() 재정의
--      - processing_started_at = now() 설정
--      - type 불일치 감지 (동일 id + 다른 type → RAISE WARNING + false)
--      - fully-qualified table reference (public.stripe_webhook_events)
--      - SET search_path / GRANT: migration 017에서 이미 적용됨, 재확인
--   3. reset_stale_webhook_claims() 추가
--      - processing=true + processing_started_at 오래된 row → processing=false 해제
--      - 프로세스 강제 종료 / 서버 재시작 시 stale lock 복구 경로
--      - 반환값: 해제된 행 수 (모니터링 용)
--
-- 참고: migration 017에서 SET search_path + GRANT service_role 이미 적용됨
--       이 migration은 010 이후 누락된 tracking 컬럼 + 복구 경로 추가
-- ============================================================

-- ============================================================
-- 1. processing_started_at 컬럼 추가
-- ============================================================
ALTER TABLE stripe_webhook_events
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

COMMENT ON COLUMN stripe_webhook_events.processing_started_at IS
  'processing=true로 claim된 시각. '
  'stale lock 감지 기준 — reset_stale_webhook_claims()가 이 값과 현재 시각을 비교. '
  'processing=false 또는 미claim 상태에서는 NULL.';

-- ============================================================
-- 2. claim_webhook_event() 재정의
--    변경사항:
--    - processing_started_at = now() 설정 (claim 시각 기록)
--    - type 불일치 감지: 동일 event_id에 다른 type이 들어오면 이상 데이터
--    - fully-qualified reference: public.stripe_webhook_events
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
  -- ── type 불일치 감지 ──────────────────────────────────────────────────────
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
  -- INSERT: 신규 이벤트 → processing=true, processing_started_at=now()
  -- UPDATE: 재시도 가능(processed=false, processing=false) → claim 재취득
  -- UPDATE 실패: 이미 processing 중 또는 처리 완료 → ROW_COUNT=0 → false 반환
  INSERT INTO public.stripe_webhook_events(
    id, type, processed, processing, processing_started_at
  )
  VALUES (p_id, p_type, false, true, now())
  ON CONFLICT (id) DO UPDATE
    SET
      processing             = true,
      processing_started_at  = now()
    WHERE public.stripe_webhook_events.processed = false
      AND public.stripe_webhook_events.processing = false;

  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  RETURN v_claimed > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_webhook_event(text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION claim_webhook_event(text, text) FROM authenticated, anon, public;

-- ============================================================
-- 3. reset_stale_webhook_claims() 추가
--    stale lock 복구 경로:
--    - 프로세스 강제 종료 / OOM / 서버 재시작 → processing 영구 잠금 방지
--    - p_timeout_minutes 이상 processing=true인 row → processing=false 해제
--    - 반환값: 해제된 행 수 (0이면 정상, 양수이면 장애 징후)
--
--    호출 방법:
--      SELECT reset_stale_webhook_claims();       -- 기본 10분
--      SELECT reset_stale_webhook_claims(5);      -- 5분 초과 stale 해제
--    권장 운영 절차:
--      - 서버 재배포 직후 1회 실행
--      - 또는 Vercel cron으로 주기 실행 (별도 cron handler 필요)
-- ============================================================
CREATE OR REPLACE FUNCTION reset_stale_webhook_claims(
  p_timeout_minutes integer DEFAULT 10
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reset integer := 0;
BEGIN
  WITH updated AS (
    UPDATE public.stripe_webhook_events
    SET
      processing             = false,
      processing_started_at  = NULL
    WHERE processing             = true
      AND processed              = false
      AND processing_started_at  < now() - (p_timeout_minutes || ' minutes')::interval
    RETURNING id
  )
  SELECT count(*) INTO v_reset FROM updated;

  IF v_reset > 0 THEN
    RAISE NOTICE 'reset_stale_webhook_claims: released % stale locks (timeout=% min)',
      v_reset, p_timeout_minutes;
  END IF;

  RETURN v_reset;
END;
$$;

GRANT EXECUTE ON FUNCTION reset_stale_webhook_claims(integer) TO service_role;
REVOKE EXECUTE ON FUNCTION reset_stale_webhook_claims(integer) FROM authenticated, anon, public;
