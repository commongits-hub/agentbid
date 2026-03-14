-- Migration 012: webhook processing lock
-- stripe_webhook_events에 processing 플래그 추가 + atomic claim 함수
-- 목적: 동시에 동일 webhook event가 두 번 들어올 때 경쟁 상태(race condition) 방지

-- ── 1. processing 컬럼 추가 ────────────────────────────────────────────────────
ALTER TABLE stripe_webhook_events
  ADD COLUMN IF NOT EXISTS processing boolean NOT NULL DEFAULT false;

-- ── 2. claim_webhook_event() — atomic event 소유권 획득 ────────────────────────
-- 반환값:
--   true  → 이 핸들러가 이벤트 처리권 획득 (processing = true로 설정됨)
--   false → 이미 처리 중(processing=true) 또는 완료(processed=true) → 스킵
--
-- 원리: PostgreSQL INSERT ON CONFLICT DO UPDATE ... WHERE
--   - 신규 이벤트:  INSERT 성공 → ROW_COUNT = 1 → true
--   - 기존 + 미처리 + 비처리중: UPDATE WHERE processed=false AND processing=false → ROW_COUNT = 1 → true
--   - 기존 + 처리중 또는 완료:  WHERE 조건 불일치 → ROW_COUNT = 0 → false
--
-- ⚠️ 이 함수는 service_role에서만 호출됨 (webhook handler)
CREATE OR REPLACE FUNCTION claim_webhook_event(p_id text, p_type text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_claimed integer := 0;
BEGIN
  INSERT INTO stripe_webhook_events(id, type, processed, processing)
  VALUES (p_id, p_type, false, true)
  ON CONFLICT (id) DO UPDATE
    SET processing = true
    WHERE stripe_webhook_events.processed = false
      AND stripe_webhook_events.processing = false;

  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  RETURN v_claimed > 0;
END;
$$;
