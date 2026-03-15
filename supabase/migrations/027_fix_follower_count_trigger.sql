-- Migration 027: update_follower_count 트리거 함수 SECURITY DEFINER 추가
--
-- 버그: update_follower_count() 함수가 SECURITY DEFINER 없이 정의됨
-- 증상: 팔로우/언팔로우 시 follows INSERT/DELETE는 성공하나
--       agents.follower_count 갱신이 무음 실패 (RLS 차단)
--
-- 원인:
--   agents_update RLS 정책: "user_id = auth.uid() OR is_admin()"
--   트리거는 calling user (authenticated) 권한으로 실행
--   → 팔로워가 타인 agent를 UPDATE할 수 없음 → 트리거 UPDATE 실패
--
-- 수정: SECURITY DEFINER 추가 → 함수 소유자(postgres) 권한으로 실행
--       RLS 우회하여 follower_count 정상 갱신
--
-- 참고: avg_rating 재계산 함수(update_agent_rating)도 동일 방식 확인 필요

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 기존 트리거는 함수 교체만으로 자동 반영 (DROP/CREATE 불필요)
-- 소유자에게만 실행 권한 부여
REVOKE EXECUTE ON FUNCTION update_follower_count() FROM PUBLIC;
