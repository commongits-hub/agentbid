-- Migration 045: Fix handle_new_user search_path and inline safe cast
--
-- Problem in 044:
--   safe_user_role() function doesn't have search_path set,
--   so it can't find public.user_role when called from supabase_auth_admin context.
--
-- Fix:
--   - Set search_path = public on the helper function
--   - Also set it on handle_new_user
--   - Use inline EXCEPTION block directly in handle_new_user to avoid function call overhead

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_role     public.user_role;
  v_nickname text;
  v_requested text;
BEGIN
  v_nickname := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'nickname'), ''),
    'user_' || substr(NEW.id::text, 1, 8)
  );

  -- Try requested_role first, then legacy role key, default to 'user'
  v_requested := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'requested_role'), ''),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'role'), '')
  );

  BEGIN
    v_role := v_requested::public.user_role;
  EXCEPTION WHEN others THEN
    v_role := 'user'::public.user_role;
  END;

  IF v_role IS NULL THEN
    v_role := 'user'::public.user_role;
  END IF;

  INSERT INTO public.users (id, email, role)
  VALUES (NEW.id, NEW.email, v_role)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, nickname)
  VALUES (NEW.id, v_nickname)
  ON CONFLICT (id) DO NOTHING;

  IF v_role = 'provider'::public.user_role THEN
    INSERT INTO public.agents (id, user_id, name)
    VALUES (gen_random_uuid(), NEW.id, v_nickname)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
