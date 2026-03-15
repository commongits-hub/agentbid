-- ============================================================
-- Migration 030: trigger 함수 SECURITY DEFINER + search_path 보강
-- 적용 대상: 005_create_reviews_follows_reports.sql 트리거 함수 4개
--
-- 공통 문제:
--   SECURITY DEFINER 없는 트리거 함수는 calling user(authenticated) 권한으로 실행
--   → 타인 row(agents.avg_rating, agents.follower_count 등) UPDATE가 RLS에 차단됨
--   → 집계 결과가 무음 실패 가능 (follower_count 버그와 같은 패턴, 027 참조)
--
-- ⚠️ 이 파일의 모든 함수는 trigger 전용 함수입니다.
--    API/RPC를 통한 direct invocation 금지.
--    REVOKE EXECUTE FROM PUBLIC으로 직접 호출 차단.
--    trigger는 테이블 이벤트로만 실행됩니다.
-- ============================================================

-- ------------------------------------------------------------
-- [1] recalculate_agent_rating()
--     reviews INSERT/UPDATE/DELETE 시 agents.avg_rating 갱신
--     리뷰 작성자는 타인 agent row UPDATE 권한 없음 → SECURITY DEFINER 필수
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION recalculate_agent_rating()
RETURNS TRIGGER AS $$
DECLARE
  v_agent_id uuid;
BEGIN
  v_agent_id := COALESCE(NEW.agent_id, OLD.agent_id);

  UPDATE public.agents
  SET avg_rating = (
    SELECT ROUND(AVG(rating)::numeric, 2)
    FROM public.reviews
    WHERE agent_id = v_agent_id
      AND status = 'published'
  )
  WHERE id = v_agent_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION recalculate_agent_rating() FROM PUBLIC;

-- ------------------------------------------------------------
-- [2] update_follower_count()
--     027에서 SECURITY DEFINER 추가됨, 이번에 search_path + public. 보강
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_follower_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.agents SET follower_count = follower_count + 1 WHERE id = NEW.agent_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.agents SET follower_count = GREATEST(follower_count - 1, 0) WHERE id = OLD.agent_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION update_follower_count() FROM PUBLIC;

-- ------------------------------------------------------------
-- [3] auto_flag_on_reports()
--     신고 3회 누적 시 submission/review 자동 flagged 처리
--     신고자는 타인 submission/review row UPDATE 권한 없음 → SECURITY DEFINER 필수
--
--     상태 필터 의도 명시:
--       status IN ('pending', 'reviewed') — 아직 처리 중인 신고만 집계
--       resolved/dismissed는 처리 완료된 신고이므로 누적 기준에서 제외
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION auto_flag_on_reports()
RETURNS TRIGGER AS $$
DECLARE
  v_count integer;
BEGIN
  -- 해당 target의 미처리 신고 수 집계 (resolved/dismissed 제외)
  SELECT COUNT(*) INTO v_count
  FROM public.reports
  WHERE target_type = NEW.target_type
    AND target_id = NEW.target_id
    AND status IN ('pending', 'reviewed');

  -- 3회 이상 시 자동 flagged 처리
  IF v_count >= 3 THEN
    IF NEW.target_type = 'submission' THEN
      UPDATE public.submissions SET status = 'flagged'
      WHERE id = NEW.target_id AND status = 'submitted';
    ELSIF NEW.target_type = 'review' THEN
      UPDATE public.reviews SET status = 'flagged'
      WHERE id = NEW.target_id AND status = 'published';
    END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION auto_flag_on_reports() FROM PUBLIC;

-- ------------------------------------------------------------
-- [4] update_agent_completed_count()
--     order paid 전환 시 agents.completed_count +1
--     webhook/service_role 경유가 일반적이나, admin 수동 update 등
--     invoker가 달라질 수 있어 SECURITY DEFINER로 일관성 확보
--
--     정책: paid 기준 historical count (refund 시 -1 없음)
--       → "한 번이라도 구매 완료된 작업 수" 기준
--       → 환불 정책 변경 시 별도 migration 필요
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_agent_completed_count()
RETURNS TRIGGER AS $$
DECLARE
  v_agent_id uuid;
BEGIN
  IF NEW.status = 'paid' AND OLD.status != 'paid' THEN
    SELECT s.agent_id INTO v_agent_id
    FROM public.submissions s WHERE s.id = NEW.submission_id;

    UPDATE public.agents
    SET completed_count = completed_count + 1
    WHERE id = v_agent_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION update_agent_completed_count() FROM PUBLIC;
