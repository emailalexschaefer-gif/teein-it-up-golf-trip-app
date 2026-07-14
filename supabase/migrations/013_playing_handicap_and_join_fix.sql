-- =============================================================================
-- 013: playing_handicap column + range constraint on trip_members
-- Supersedes the earlier 013_playing_handicap.sql (which had no constraint).
-- Safe to run multiple times — uses IF NOT EXISTS / DO $$ checks.
-- No existing data is deleted or altered.
-- =============================================================================

-- ── 1. Add playing_handicap column ───────────────────────────────────────────
ALTER TABLE public.trip_members
  ADD COLUMN IF NOT EXISTS playing_handicap NUMERIC(4,1) NULL;

-- ── 2. Add range constraint (idempotent) ─────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trip_members_playing_handicap_range'
  ) THEN
    ALTER TABLE public.trip_members
      ADD CONSTRAINT trip_members_playing_handicap_range
        CHECK (
          playing_handicap IS NULL
          OR playing_handicap BETWEEN -10 AND 54
        );
  END IF;
END $$;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT
--   (SELECT COUNT(*) FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='trip_members'
--      AND column_name='playing_handicap') AS col_exists,     -- must be 1
--   (SELECT COUNT(*) FROM pg_constraint
--    WHERE conname='trip_members_playing_handicap_range') AS constraint_exists; -- must be 1
