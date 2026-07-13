-- =============================================================================
-- 014: Profile signup improvements
-- Updates handle_new_user trigger to also save handicap from user metadata.
-- profiles.handicap already exists from 001_profiles.sql — no new columns.
-- Safe to run multiple times (OR REPLACE is idempotent).
-- =============================================================================

-- Update the trigger function to also save handicap when provided at signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_handicap DECIMAL(4,1);
  v_hcp_raw  TEXT;
BEGIN
  -- Read handicap from metadata if present (stored as string, cast safely)
  v_hcp_raw := NEW.raw_user_meta_data->>'handicap';
  IF v_hcp_raw IS NOT NULL AND v_hcp_raw <> '' THEN
    BEGIN
      v_handicap := v_hcp_raw::DECIMAL(4,1);
    EXCEPTION WHEN OTHERS THEN
      v_handicap := NULL;  -- invalid value — store null, not 0
    END;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, handicap)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    v_handicap
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    handicap  = COALESCE(EXCLUDED.handicap, public.profiles.handicap);
    -- ON CONFLICT: update name if provided, update handicap only if a new one is given
    -- (don't overwrite an existing handicap with null)

  RETURN NEW;
END;
$$;

-- Verification:
-- SELECT prosrc FROM pg_proc WHERE proname = 'handle_new_user';
-- Should show the handicap logic above.
