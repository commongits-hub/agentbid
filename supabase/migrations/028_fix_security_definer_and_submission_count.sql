-- ============================================================
-- Migration 028: security_definer search_path 보강 + submission_count DELETE 처리
-- 적용 대상: migration 002, 003에서 누락된 보안/정확성 수정
-- ============================================================

-- ------------------------------------------------------------
-- [1] handle_new_user() — SECURITY DEFINER + SET search_path = public
--     auth 컨텍스트에서 search_path 불일치로 테이블 못 찾는 버그 방지
--     테이블 참조 public. 명시적 qualification 추가
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'user')
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, nickname)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nickname', 'user_' || substr(NEW.id::text, 1, 8))
  )
  ON CONFLICT (id) DO NOTHING;

  IF (NEW.raw_user_meta_data->>'role') = 'provider' THEN
    INSERT INTO public.agents (id, user_id, name)
    VALUES (gen_random_uuid(), NEW.id, COALESCE(NEW.raw_user_meta_data->>'nickname', ''))
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------
-- [2] sync_user_email() — SECURITY DEFINER + SET search_path = public
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_user_email()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.users SET email = NEW.email WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------
-- [3] update_submission_count() — DELETE 처리 추가
--     INSERT / soft_delete UPDATE / hard DELETE 3가지 모두 처리
--     관리자 정리, 테스트 데이터 삭제 시 submission_count 정확도 보장
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_submission_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.soft_deleted_at IS NULL THEN
    -- 새 submission 등록 → +1
    UPDATE public.tasks
    SET submission_count = submission_count + 1
    WHERE id = NEW.task_id;

  ELSIF TG_OP = 'UPDATE'
    AND NEW.soft_deleted_at IS NOT NULL
    AND OLD.soft_deleted_at IS NULL THEN
    -- soft delete → -1
    UPDATE public.tasks
    SET submission_count = GREATEST(submission_count - 1, 0)
    WHERE id = OLD.task_id;

  ELSIF TG_OP = 'DELETE' AND OLD.soft_deleted_at IS NULL THEN
    -- hard delete (soft_deleted_at 없는 row) → -1
    -- 이미 soft delete된 row는 이미 -1 반영됐으므로 중복 차감 방지
    UPDATE public.tasks
    SET submission_count = GREATEST(submission_count - 1, 0)
    WHERE id = OLD.task_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 트리거에 DELETE 추가 (기존 트리거 교체)
DROP TRIGGER IF EXISTS trg_submission_count ON public.submissions;
CREATE TRIGGER trg_submission_count
  AFTER INSERT OR UPDATE OR DELETE ON public.submissions
  FOR EACH ROW EXECUTE FUNCTION update_submission_count();
