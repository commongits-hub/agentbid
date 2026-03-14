-- ============================================================
-- Migration 002: Users / Profiles / Agents / Categories / Fee Policies
-- Author: commongits-hub
-- Description: 사용자, 에이전트, 카테고리, 수수료 기반 테이블
-- 선행: 001_create_enums.sql
-- ============================================================

-- ------------------------------------------------------------
-- public.users
-- auth.users 확장 테이블. role, 활성 상태 등 앱 전용 필드 관리
-- email은 auth.users와 동기화 트리거로 유지
-- ------------------------------------------------------------
CREATE TABLE public.users (
  id          uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text        NOT NULL UNIQUE,
  role        user_role   NOT NULL DEFAULT 'user',
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- public.profiles
-- 닉네임, 소개, 아바타 등 유저 공개 프로필
-- ------------------------------------------------------------
CREATE TABLE public.profiles (
  id                  uuid        PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  nickname            text        NOT NULL UNIQUE,
  bio                 text,
  avatar_url          text,  -- avatars 버킷 상대 경로: avatars/{user_id}/avatar.{ext}
  profile_completed   boolean     NOT NULL DEFAULT false,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_nickname ON profiles(nickname);

-- ------------------------------------------------------------
-- categories
-- 관리자가 관리하는 작업 카테고리
-- ------------------------------------------------------------
CREATE TABLE categories (
  id         uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text    NOT NULL UNIQUE,
  slug       text    NOT NULL UNIQUE,
  is_active  boolean NOT NULL DEFAULT true
);

-- 초기 카테고리 데이터
INSERT INTO categories (name, slug) VALUES
  ('텍스트 생성', 'text-generation'),
  ('이미지 생성', 'image-generation'),
  ('코드 작성', 'code-generation'),
  ('데이터 분석', 'data-analysis'),
  ('번역', 'translation'),
  ('요약', 'summarization'),
  ('기타', 'etc');

-- ------------------------------------------------------------
-- agents
-- Provider의 AI Agent 프로필
-- user_id: 1:1 (Provider 계정당 1개)
-- ------------------------------------------------------------
CREATE TABLE agents (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  name                text        NOT NULL DEFAULT '',
  description         text,
  avg_rating          numeric(3,2),
  completed_count     integer     NOT NULL DEFAULT 0,
  follower_count      integer     NOT NULL DEFAULT 0,
  stripe_account_id   text,       -- Stripe Connect Express Account ID
  is_verified         boolean     NOT NULL DEFAULT false,
  -- API 마켓 확장 준비 컬럼 (MVP에서는 사용 안 함, nullable)
  api_enabled         boolean     NOT NULL DEFAULT false,
  api_endpoint        text,
  api_pricing_per_call integer,
  created_at          timestamptz NOT NULL DEFAULT now(),
  soft_deleted_at     timestamptz
);

CREATE INDEX idx_agents_user_id ON agents(user_id);
CREATE INDEX idx_agents_avg_rating ON agents(avg_rating DESC NULLS LAST);
CREATE INDEX idx_agents_completed_count ON agents(completed_count DESC);

-- ------------------------------------------------------------
-- agent_categories (조인 테이블)
-- agents.category_ids 배열 대신 조인 테이블로 관리
-- agent당 최대 5개 제한은 API 레벨에서 적용
-- ------------------------------------------------------------
CREATE TABLE agent_categories (
  agent_id     uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  category_id  uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (agent_id, category_id)
);

CREATE INDEX idx_agent_categories_category ON agent_categories(category_id);
CREATE INDEX idx_agent_categories_agent ON agent_categories(agent_id);

-- ------------------------------------------------------------
-- fee_policies
-- 수수료율 이력 관리. 최신 레코드가 현재 적용 수수료
-- 관리자만 생성/조회 가능
-- ------------------------------------------------------------
CREATE TABLE fee_policies (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rate            numeric(5,4) NOT NULL CHECK (rate > 0 AND rate < 1),
  effective_from  timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL REFERENCES public.users(id),
  note            text
);

-- 초기 수수료: 20%
-- created_by는 첫 admin 계정 생성 후 업데이트 필요
-- 임시로 system placeholder 사용 불가, 배포 시 admin id로 INSERT
-- INSERT INTO fee_policies (rate, note, created_by) VALUES (0.2000, '초기 수수료 20%', '<admin_user_id>');

-- ------------------------------------------------------------
-- 트리거: auth.users 가입 시 public.users + profiles + agents 자동 생성
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- public.users 생성
  INSERT INTO public.users (id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'user')
  )
  ON CONFLICT (id) DO NOTHING;

  -- profiles 생성 (nickname은 임시값, 프로필 설정 페이지에서 완성)
  INSERT INTO public.profiles (id, nickname)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nickname', 'user_' || substr(NEW.id::text, 1, 8))
  )
  ON CONFLICT (id) DO NOTHING;

  -- Provider면 agents 레코드 생성
  IF (NEW.raw_user_meta_data->>'role') = 'provider' THEN
    INSERT INTO agents (id, user_id, name)
    VALUES (gen_random_uuid(), NEW.id, COALESCE(NEW.raw_user_meta_data->>'nickname', ''))
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ------------------------------------------------------------
-- 트리거: auth.users 이메일 변경 시 public.users.email 동기화
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_user_email()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.users SET email = NEW.email WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_email_updated
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION sync_user_email();

-- ------------------------------------------------------------
-- 트리거: profiles.updated_at 자동 갱신
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
