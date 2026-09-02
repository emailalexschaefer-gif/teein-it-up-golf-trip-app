-- =============================================================================
-- 073_profile_user_intent.sql
-- =============================================================================
-- Crucial MVP Onboarding Update — capture Player/Organiser/Both intent.
--
-- INVESTIGATION FIRST, per the explicit instruction:
--   - No Player/Organiser/Both (or equivalent) field exists anywhere in
--     this project's migration history — confirmed by reading every
--     migration that touches public.profiles (001, 012, 014, 015, 026,
--     039). The only role-like field is `app_role` ('member'/'admin',
--     migration 039) — an APPLICATION PERMISSION (admin access), not
--     user intent/segmentation. Explicitly not reused, per this
--     brief's own "do not confuse this with application permissions"
--     instruction — a user selecting "Organiser" here gets zero change
--     to app_role or to any trip-level permission.
--   - No existing preferences/multi-select array structure exists on
--     profiles to reuse for the organiser-type follow-up either.
--   - Nothing suitable to reuse — this migration adds both fields new,
--     using the project's existing plain-column convention (matching
--     handicap_status's own TEXT + CHECK constraint pattern) rather
--     than introducing a JSONB preferences blob this project has never
--     used elsewhere.
--
-- user_intent — nullable by design. NULL means "not yet asked" (every
-- existing account, and any new account before completing the
-- onboarding step) — never a forced, non-null default, so existing
-- accounts are never silently miscategorised as anything.
--
-- organiser_types — TEXT[], nullable, only meaningful when user_intent
-- is 'organiser' or 'both'. Not constrained to a fixed CHECK'd enum
-- (unlike user_intent) because "Other" is an explicit allowed value and
-- future organiser-type categories may be added without a schema
-- migration — the application layer owns validating/rendering the
-- known set.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS user_intent TEXT NULL,
  ADD COLUMN IF NOT EXISTS organiser_types TEXT[] NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_user_intent_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_user_intent_check
      CHECK (user_intent IS NULL OR user_intent IN ('player', 'organiser', 'both'));
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.user_intent IS
  'Customer-segmentation signal captured during onboarding: how the player self-identifies (player / organiser / both). NULL = not yet asked (all pre-existing accounts, and new accounts before onboarding completes). Deliberately NOT an application permission — never grants organiser access to any trip on its own.';
COMMENT ON COLUMN public.profiles.organiser_types IS
  'Optional multi-select follow-up shown only when user_intent is organiser or both. Free-form TEXT[] (e.g. golf_trips, social_golf, corporate, club_community, other) — validated/rendered by the application layer, not a DB-level enum.';

NOTIFY pgrst, 'reload schema';
