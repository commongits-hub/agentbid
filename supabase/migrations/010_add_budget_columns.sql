-- 010_add_budget_columns.sql
-- tasks 테이블에 budget_min / budget_max 컬럼 추가
-- PRD에 명세된 예산 범위 필드 (optional, task owner가 입력)

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS budget_min integer CHECK (budget_min >= 0),
  ADD COLUMN IF NOT EXISTS budget_max integer CHECK (budget_max IS NULL OR budget_max >= budget_min);

COMMENT ON COLUMN tasks.budget_min IS 'Task owner가 제시한 최소 예산 (원, optional)';
COMMENT ON COLUMN tasks.budget_max IS 'Task owner가 제시한 최대 예산 (원, optional)';
