-- ============================================================
-- Migration 005: Reviews / Follows / Reports
-- Author: commongits-hub
-- Description: 리뷰, 팔로우, 신고 테이블
-- 선행: 004_create_orders_and_payouts.sql
-- ============================================================

-- ------------------------------------------------------------
-- reviews
-- 결제 완료 후 유저가 작성하는 Agent 평가
-- order_id UNIQUE → 1주문 = 1리뷰 강제
-- 작성 후 7일 이내만 수정 허용 (API 레벨 적용)
-- ------------------------------------------------------------
CREATE TABLE reviews (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid          NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  user_id     uuid          NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  agent_id    uuid          NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  rating      smallint      NOT NULL CHECK (rating BETWEEN 1 AND 5),
  content     text          NOT NULL CHECK (length(trim(content)) >= 10),
  status      review_status NOT NULL DEFAULT 'published',
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_reviews_agent_id ON reviews(agent_id) WHERE status = 'published';
CREATE INDEX idx_reviews_user_id ON reviews(user_id);
CREATE INDEX idx_reviews_created ON reviews(created_at DESC);

CREATE TRIGGER trg_reviews_updated_at
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- 트리거: 리뷰 작성/수정 시 agents.avg_rating 재계산
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION recalculate_agent_rating()
RETURNS TRIGGER AS $$
DECLARE
  v_agent_id uuid;
BEGIN
  v_agent_id := COALESCE(NEW.agent_id, OLD.agent_id);

  UPDATE agents
  SET avg_rating = (
    SELECT ROUND(AVG(rating)::numeric, 2)
    FROM reviews
    WHERE agent_id = v_agent_id
      AND status = 'published'
  )
  WHERE id = v_agent_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recalculate_rating
  AFTER INSERT OR UPDATE OR DELETE ON reviews
  FOR EACH ROW EXECUTE FUNCTION recalculate_agent_rating();

-- ------------------------------------------------------------
-- follows
-- 유저가 Agent를 팔로우
-- UNIQUE(follower_id, agent_id) → 중복 팔로우 DB 레벨 차단
-- ------------------------------------------------------------
CREATE TABLE follows (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id  uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  agent_id     uuid        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(follower_id, agent_id)
);

CREATE INDEX idx_follows_agent_id ON follows(agent_id);
CREATE INDEX idx_follows_follower_id ON follows(follower_id);

-- ------------------------------------------------------------
-- 트리거: 팔로우/언팔로우 시 agents.follower_count 갱신
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_follower_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE agents SET follower_count = follower_count + 1 WHERE id = NEW.agent_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE agents SET follower_count = GREATEST(follower_count - 1, 0) WHERE id = OLD.agent_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_follower_count
  AFTER INSERT OR DELETE ON follows
  FOR EACH ROW EXECUTE FUNCTION update_follower_count();

-- ------------------------------------------------------------
-- reports
-- 유저/관리자 신고 테이블
-- target_type + target_id로 어떤 엔티티든 신고 가능
-- 동일 target에 대한 reporter 중복 신고 방지 (UNIQUE)
-- ------------------------------------------------------------
CREATE TABLE reports (
  id           uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  uuid                NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  target_type  report_target_type  NOT NULL,
  target_id    uuid                NOT NULL,
  reason       text                NOT NULL CHECK (length(trim(reason)) >= 10),
  status       report_status       NOT NULL DEFAULT 'pending',
  admin_note   text,
  created_at   timestamptz         NOT NULL DEFAULT now(),
  UNIQUE(reporter_id, target_type, target_id)  -- 동일 대상 중복 신고 방지
);

CREATE INDEX idx_reports_status ON reports(status) WHERE status = 'pending';
CREATE INDEX idx_reports_target ON reports(target_type, target_id);
CREATE INDEX idx_reports_reporter ON reports(reporter_id);

-- ------------------------------------------------------------
-- 트리거: 신고 3회 누적 시 자동 플래그 처리
-- submission/review 대상에만 적용
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION auto_flag_on_reports()
RETURNS TRIGGER AS $$
DECLARE
  v_count integer;
BEGIN
  -- 해당 target의 pending/reviewed 신고 수 집계
  SELECT COUNT(*) INTO v_count
  FROM reports
  WHERE target_type = NEW.target_type
    AND target_id = NEW.target_id
    AND status IN ('pending', 'reviewed');

  -- 3회 이상 시 자동 flagged 처리
  IF v_count >= 3 THEN
    IF NEW.target_type = 'submission' THEN
      UPDATE submissions SET status = 'flagged'
      WHERE id = NEW.target_id AND status = 'submitted';
    ELSIF NEW.target_type = 'review' THEN
      UPDATE reviews SET status = 'flagged'
      WHERE id = NEW.target_id AND status = 'published';
    END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_flag
  AFTER INSERT ON reports
  FOR EACH ROW EXECUTE FUNCTION auto_flag_on_reports();

-- ------------------------------------------------------------
-- 트리거: order paid 시 agents.completed_count +1
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_agent_completed_count()
RETURNS TRIGGER AS $$
DECLARE
  v_agent_id uuid;
BEGIN
  IF NEW.status = 'paid' AND OLD.status != 'paid' THEN
    SELECT s.agent_id INTO v_agent_id
    FROM submissions s WHERE s.id = NEW.submission_id;

    UPDATE agents
    SET completed_count = completed_count + 1
    WHERE id = v_agent_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_agent_completed_count
  AFTER UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION update_agent_completed_count();
