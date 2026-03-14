-- ============================================================
-- Migration 003: Tasks / Task Attachments / Submissions
-- Author: commongits-hub
-- Description: 작업 등록 및 제출 관련 테이블
-- 선행: 002_create_users_and_agents.sql
-- ============================================================

-- ------------------------------------------------------------
-- tasks
-- 유저가 등록하는 AI 작업
-- selected_submission_id는 circular FK로 DEFERRABLE 처리
-- ------------------------------------------------------------
CREATE TABLE tasks (
  id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid          NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  category_id             uuid          REFERENCES categories(id) ON DELETE SET NULL,
  title                   text          NOT NULL CHECK (length(trim(title)) >= 5),
  description             text          NOT NULL CHECK (length(trim(description)) >= 20),
  status                  task_status   NOT NULL DEFAULT 'draft',
  deadline_at             timestamptz,
  published_at            timestamptz,
  reviewing_at            timestamptz,  -- reviewing 진입 시점 기록 (expired 기준 컬럼)
  submission_count        integer       NOT NULL DEFAULT 0,
  selected_submission_id  uuid,         -- FK 아래에서 DEFERRABLE로 추가
  created_at              timestamptz   NOT NULL DEFAULT now(),
  soft_deleted_at         timestamptz
);

CREATE INDEX idx_tasks_user_id ON tasks(user_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_deadline ON tasks(deadline_at) WHERE status = 'open';
CREATE INDEX idx_tasks_category ON tasks(category_id) WHERE soft_deleted_at IS NULL;
CREATE INDEX idx_tasks_published ON tasks(published_at DESC) WHERE status = 'open';

-- ------------------------------------------------------------
-- task_attachments
-- task에 첨부된 참고 파일
-- ------------------------------------------------------------
CREATE TABLE task_attachments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  file_path   text        NOT NULL,   -- 상대 경로: tasks/{task_id}/{filename}
  file_name   text        NOT NULL,
  file_size   integer     NOT NULL CHECK (file_size > 0 AND file_size <= 52428800), -- 50MB
  mime_type   text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_attachments_task ON task_attachments(task_id);

-- ------------------------------------------------------------
-- submissions
-- Provider가 task에 제출한 결과물
-- file_path: 상대 경로만 저장 (signed URL은 API 레벨에서 생성)
-- preview_text: content_text 첫 200자 (자동 생성)
-- preview_thumbnail_url: 이미지 파일의 블러 썸네일 (처리 후 저장)
-- quoted_price: Provider가 제출 시 입력, 선택 시 결제 금액 기준
-- ------------------------------------------------------------
CREATE TABLE submissions (
  id                       uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id                  uuid               NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  agent_id                 uuid               NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  status                   submission_status  NOT NULL DEFAULT 'submitted',
  quoted_price             integer            NOT NULL CHECK (quoted_price >= 1000 AND quoted_price <= 10000000),
  preview_text             text,              -- content_text 첫 200자, 항상 공개
  preview_thumbnail_url    text,              -- 블러 썸네일 상대 경로, 항상 공개
  content_text             text,              -- 원본 텍스트 (purchased 또는 본인만 접근)
  file_path                text,              -- 상대 경로: submissions/{id}/{filename}
  file_name                text,
  file_size                integer            CHECK (file_size IS NULL OR (file_size > 0 AND file_size <= 104857600)), -- 100MB
  mime_type                text,
  created_at               timestamptz        NOT NULL DEFAULT now(),
  updated_at               timestamptz        NOT NULL DEFAULT now(),
  soft_deleted_at          timestamptz,
  UNIQUE(task_id, agent_id) -- task당 agent 중복 제출 방지
);

CREATE INDEX idx_submissions_task_id ON submissions(task_id) WHERE soft_deleted_at IS NULL;
CREATE INDEX idx_submissions_agent_id ON submissions(agent_id) WHERE soft_deleted_at IS NULL;
CREATE INDEX idx_submissions_status ON submissions(status);
CREATE INDEX idx_submissions_task_status ON submissions(task_id, status);

-- ------------------------------------------------------------
-- tasks.selected_submission_id FK (DEFERRABLE, circular 허용)
-- 트랜잭션 내에서 tasks와 submissions를 동시에 업데이트할 수 있도록
-- ------------------------------------------------------------
ALTER TABLE tasks
  ADD CONSTRAINT fk_tasks_selected_submission
  FOREIGN KEY (selected_submission_id)
  REFERENCES submissions(id)
  ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

-- ------------------------------------------------------------
-- 트리거: selected_submission_id ↔ submission.task_id 일치 검증
-- task의 selected_submission_id는 반드시 해당 task의 submission이어야 함
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_selected_submission()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.selected_submission_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM submissions
      WHERE id = NEW.selected_submission_id
        AND task_id = NEW.id
        AND status = 'selected'
        AND soft_deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'selected_submission_id must reference a submission with status=selected belonging to this task (task_id mismatch or invalid status)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_selected_submission
  BEFORE UPDATE OF selected_submission_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION validate_selected_submission();

-- ------------------------------------------------------------
-- 트리거: submissions.submission_count 자동 갱신
-- insert 시 +1, soft_delete 시 -1
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_submission_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.soft_deleted_at IS NULL THEN
    UPDATE tasks
    SET submission_count = submission_count + 1
    WHERE id = NEW.task_id;

  ELSIF TG_OP = 'UPDATE'
    AND NEW.soft_deleted_at IS NOT NULL
    AND OLD.soft_deleted_at IS NULL THEN
    UPDATE tasks
    SET submission_count = GREATEST(submission_count - 1, 0)
    WHERE id = OLD.task_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_submission_count
  AFTER INSERT OR UPDATE ON submissions
  FOR EACH ROW EXECUTE FUNCTION update_submission_count();

-- ------------------------------------------------------------
-- 트리거: submissions.updated_at 자동 갱신
-- ------------------------------------------------------------
CREATE TRIGGER trg_submissions_updated_at
  BEFORE UPDATE ON submissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- 트리거: task 상태 자동 전이 (deadline 도달 시 open → reviewing)
-- Supabase pg_cron으로 매시간 호출 (migration 007에서 설정)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION close_expired_tasks()
RETURNS void AS $$
BEGIN
  -- [1] open 상태에서 deadline 지난 task → reviewing
  -- reviewing_at 기록 (expired 기준 시점)
  UPDATE tasks
  SET
    status = 'reviewing',
    reviewing_at = now()
  WHERE status = 'open'
    AND deadline_at IS NOT NULL
    AND deadline_at <= now()
    AND soft_deleted_at IS NULL;

  -- [2] reviewing 상태에서 reviewing_at 기준 7일 경과 + 미선택 → expired
  -- 정책 확정: "reviewing에 진입한 시점(reviewing_at)으로부터 7일"
  -- reviewing_at이 NULL인 구버전 레코드는 deadline_at + 7일 기준으로 폴백
  UPDATE tasks
  SET status = 'expired'
  WHERE status = 'reviewing'
    AND selected_submission_id IS NULL
    AND (
      -- reviewing_at 있으면 해당 기준 사용
      (reviewing_at IS NOT NULL AND reviewing_at + INTERVAL '7 days' <= now())
      -- reviewing_at 없으면 deadline_at 기준 폴백
      OR (reviewing_at IS NULL AND deadline_at IS NOT NULL AND deadline_at + INTERVAL '7 days' <= now())
    )
    AND soft_deleted_at IS NULL;

  -- [3] expired task의 submitted submissions → unselected
  UPDATE submissions
  SET status = 'unselected'
  WHERE status = 'submitted'
    AND task_id IN (
      SELECT id FROM tasks WHERE status = 'expired'
    )
    AND soft_deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql;
