-- Migration 044: Fix handle_new_user safe casting for requested_role
--
-- Problem:
--   043 used direct casting (value::user_role) inside COALESCE.
--   In PostgreSQL, invalid enum casts throw an ERROR, not NULL.
--   This caused "Database error saving new user" on signup.
--
-- Fix:
--   Use a safe cast helper that returns NULL on invalid values instead of erroring.

CREATE OR REPLACE FUNCTION safe_user_role(val text)
RETURNS user_role
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN val::user_role;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN NULL;
  WHEN others THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_role     user_role;
  v_nickname text;
BEGIN
  -- Safe cast: prefer requested_role, fall back to role, default user
  v_role := COALESCE(
    safe_user_role(NEW.raw_user_meta_data->>'requested_role'),
    safe_user_role(NEW.raw_user_meta_data->>'role'),
    'user'::user_role
  );

  v_nickname := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'nickname'), ''),
    'user_' || substr(NEW.id::text, 1, 8)
  );

  INSERT INTO public.users (id, email, role)
  VALUES (NEW.id, NEW.email, v_role)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, nickname)
  VALUES (NEW.id, v_nickname)
  ON CONFLICT (id) DO NOTHING;

  IF v_role = 'provider' THEN
    INSERT INTO agents (id, user_id, name)
    VALUES (gen_random_uuid(), NEW.id, v_nickname)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
