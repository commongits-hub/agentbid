-- migration 011: transfer-payouts pg_cron 스케줄 등록
-- Edge Function을 매일 03:00 UTC에 pg_net으로 호출
-- verify_jwt=false로 배포된 함수이므로 Authorization 헤더 불필요

-- 기존 job 있으면 제거 후 재등록 (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'transfer-payouts') THEN
    PERFORM cron.unschedule('transfer-payouts');
  END IF;
END;
$$;

SELECT cron.schedule(
  'transfer-payouts',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url       := 'https://xlhiafqcoyltgyfezdnm.supabase.co/functions/v1/transfer-payouts',
    headers   := '{"Content-Type": "application/json"}'::jsonb,
    body      := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
