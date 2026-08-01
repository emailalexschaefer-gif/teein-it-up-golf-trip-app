-- =============================================================================
-- profile_about_me_deploy.sql
-- =============================================================================
-- Complete, standalone, idempotent deployment script for the "About Me"
-- profile fields. Run this in the Supabase SQL Editor for whichever
-- project the production Vercel app is actually connected to.
--
-- Identical in content to migration 026_profile_about_me.sql. The error
-- "Could not find the 'ask_me_about' column of 'profiles' in the schema
-- cache" matches the exact same pattern already root-caused twice this
-- session for other tables (event_messages, the profile-photos bucket):
-- the migration was written correctly but never actually applied to the
-- live database. This script exists so there is one thing to paste and
-- run, plus a schema-cache reload and verification queries, rather than
-- relying on migration 026 having run.
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS location      TEXT,
  ADD COLUMN IF NOT EXISTS bio           TEXT,
  ADD COLUMN IF NOT EXISTS occupation    TEXT,
  ADD COLUMN IF NOT EXISTS company       TEXT,
  ADD COLUMN IF NOT EXISTS golf_club     TEXT,
  ADD COLUMN IF NOT EXISTS interests     TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ask_me_about  TEXT;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_bio_length_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_bio_length_check
  CHECK (bio IS NULL OR char_length(bio) <= 200);

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- VERIFICATION — run after the script above completes.
-- =============================================================================

-- Should list all 7 new columns (location, bio, occupation, company,
-- golf_club, interests, ask_me_about) alongside the original ones.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
order by ordinal_position;

-- Should confirm the 200-char bio constraint exists.
select conname from pg_constraint where conname = 'profiles_bio_length_check';
