-- ============================================================
-- Migration 031: prevent_submission_manipulation trigger chain bypass
--
-- 문제:
--   auto_flag_on_reports() (SECURITY DEFINER)에서
--   submissions.status = 'flagged' 변경 시 prevent_submission_manipulation()이 차단.
--   SECURITY DEFINER 컨텍스트에서는 auth.jwt() 없음 → is_admin() = false
--   → auto_flag 자동 상태 변경이 실제로 동작하지 않음
--
-- 해결:
--   pg_trigger_depth() > 0 이면 trigger chain 내부 실행으로 판단 → bypass
--   일반 사용자 직접 status 변경 차단 정책은 유지
--
-- 이유:
--   pg_trigger_depth()는 현재 trigger 중첩 깊이를 반환
--   0 = 직접 호출 (API/RPC), 1+ = 다른 trigger에서 호출된 상황
--   auto_flag_on_reports trigger → 내부 UPDATE → prevent_submission_manipulation trigger
--   이 경로에서 depth > 0 이므로 자동 상태 변경임을 정확히 식별 가능
--   current_user='postgres' 조건보다 안전: trigger chain만 허용, 직접 postgres 호출은 차단
-- ============================================================

CREATE OR REPLACE FUNCTION prevent_submission_manipulation()
RETURNS TRIGGER AS $$
BEGIN
  -- trigger chain 내부 실행 (예: auto_flag_on_reports → UPDATE) 은 허용
  -- pg_trigger_depth() > 0 이면 다른 trigger에서 호출된 상황
  IF pg_trigger_depth() > 0 THEN
    RETURN NEW;
  END IF;

  IF NOT is_admin() THEN
    -- ── 상시 불변 컬럼 ─────────────────────────────────────
    IF NEW.task_id IS DISTINCT FROM OLD.task_id THEN
      RAISE EXCEPTION 'Cannot change task_id on submission' USING ERRCODE = '42501';
    END IF;
    IF NEW.agent_id IS DISTINCT FROM OLD.agent_id THEN
      RAISE EXCEPTION 'Cannot change agent_id on submission' USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Cannot change submission status directly (current: %, attempted: %)',
        OLD.status, NEW.status USING ERRCODE = '42501';
    END IF;
    IF NEW.quoted_price IS DISTINCT FROM OLD.quoted_price THEN
      RAISE EXCEPTION 'Cannot change quoted_price on submission' USING ERRCODE = '42501';
    END IF;
    IF NEW.selected_at IS DISTINCT FROM OLD.selected_at THEN
      RAISE EXCEPTION 'Cannot change selected_at on submission' USING ERRCODE = '42501';
    END IF;
    IF NEW.delivered_at IS DISTINCT FROM OLD.delivered_at THEN
      RAISE EXCEPTION 'Cannot change delivered_at on submission' USING ERRCODE = '42501';
    END IF;
    IF NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
      RAISE EXCEPTION 'Cannot change approved_at on submission' USING ERRCODE = '42501';
    END IF;
    IF NEW.soft_deleted_at IS DISTINCT FROM OLD.soft_deleted_at THEN
      RAISE EXCEPTION 'Cannot change soft_deleted_at on submission' USING ERRCODE = '42501';
    END IF;

    -- ── content 컬럼: status = 'submitted' 이후에만 수정 허용 ──
    -- selected/purchased 이상으로 넘어간 제출물의 내용 변경 방지
    IF OLD.status != 'submitted' THEN
      IF NEW.content_text IS DISTINCT FROM OLD.content_text OR
         NEW.file_path    IS DISTINCT FROM OLD.file_path    OR
         NEW.file_name    IS DISTINCT FROM OLD.file_name    OR
         NEW.file_size    IS DISTINCT FROM OLD.file_size    OR
         NEW.mime_type    IS DISTINCT FROM OLD.mime_type
      THEN
        RAISE EXCEPTION 'Cannot update submission content after selection (current status: %)',
          OLD.status USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
