-- =============================================================================
-- 026_profile_about_me.sql
-- =============================================================================
-- Sprint 5I — "About Me" profile enhancement fields.
--
-- Deliberately does NOT add a new RLS policy for viewing these columns —
-- migration 002 already has "Trip members can view each other" as a
-- row-level SELECT policy on public.profiles. RLS in Postgres is per-row,
-- not per-column, so any new column added to a row already covered by an
-- existing SELECT policy is automatically visible under the same rule.
-- Adding a second, near-duplicate policy here would be redundant, not
-- additive.
--
-- 200-character limit on bio is enforced with a CHECK constraint (belt and
-- suspenders alongside client-side validation, not a replacement for it).
--
-- Idempotent: safe to run more than once.
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
