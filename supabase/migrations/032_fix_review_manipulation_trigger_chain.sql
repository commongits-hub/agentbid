-- ============================================================
-- Migration 032: prevent_review_manipulation trigger chain bypass
--
-- 문제:
--   auto_flag_on_reports() (SECURITY DEFINER)에서
--   reviews.status = 'flagged' 변경 시 prevent_review_manipulation()이 차단.
--   031에서 submissions 동일 이슈를 수정한 것과 같은 원인/해결책.
-- ============================================================

CREATE OR REPLACE FUNCTION prevent_review_manipulation()
RETURNS TRIGGER AS $$
BEGIN
  -- trigger chain 내부 실행 (예: auto_flag_on_reports → UPDATE) 은 허용
  IF pg_trigger_depth() > 0 THEN
    RETURN NEW;
  END IF;

  -- ── 불변 컬럼 (role 무관) ──────────────────────────────
  IF NEW.order_id IS DISTINCT FROM OLD.order_id THEN
    RAISE EXCEPTION 'Cannot change order_id on review' USING ERRCODE = '42501';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Cannot change user_id on review' USING ERRCODE = '42501';
  END IF;
  IF NEW.agent_id IS DISTINCT FROM OLD.agent_id THEN
    RAISE EXCEPTION 'Cannot change agent_id on review' USING ERRCODE = '42501';
  END IF;

  -- ── 역할별 제한 ────────────────────────────────────────
  IF is_admin() THEN
    -- admin: status 변경 가능, rating/content는 수정 불가 (무결성)
    IF NEW.rating IS DISTINCT FROM OLD.rating OR
       NEW.content IS DISTINCT FROM OLD.content
    THEN
      RAISE EXCEPTION 'Admin cannot edit review rating or content, only status'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    -- 일반 user: rating, content만 수정 가능
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Only admin can change review status (current: %, attempted: %)',
        OLD.status, NEW.status USING ERRCODE = '42501';
    END IF;

    -- 7일 수정 창 검증
    IF NOW() > OLD.created_at + INTERVAL '7 days' THEN
      RAISE EXCEPTION 'Review editing window has expired (7 days from creation: %)',
        OLD.created_at USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
