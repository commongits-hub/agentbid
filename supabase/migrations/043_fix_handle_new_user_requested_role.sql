-- Migration 043: Fix handle_new_user to read requested_role instead of role
--
-- Context:
--   signup client now sends `requested_role` (not `role`) in user_metadata to avoid
--   conflicts with Supabase's reserved `role` key.
--   This migration updates handle_new_user() to read requested_role from
--   raw_user_meta_data, with fallback to the legacy `role` key for backward compat.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_role user_role;
  v_nickname text;
BEGIN
  -- Read role: prefer requested_role (new), fall back to role (legacy), default user
  v_role := COALESCE(
    (NEW.raw_user_meta_data->>'requested_role')::user_role,
    (NEW.raw_user_meta_data->>'role')::user_role,
    'user'::user_role
  );

  v_nickname := COALESCE(
    NEW.raw_user_meta_data->>'nickname',
    'user_' || substr(NEW.id::text, 1, 8)
  );

  -- public.users
  INSERT INTO public.users (id, email, role)
  VALUES (NEW.id, NEW.email, v_role)
  ON CONFLICT (id) DO NOTHING;

  -- profiles
  INSERT INTO public.profiles (id, nickname)
  VALUES (NEW.id, v_nickname)
  ON CONFLICT (id) DO NOTHING;

  -- agents (provider only)
  IF v_role = 'provider' THEN
    INSERT INTO agents (id, user_id, name)
    VALUES (gen_random_uuid(), NEW.id, v_nickname)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
