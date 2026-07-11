-- =============================================================================
-- 013: Add playing_handicap to trip_members
-- profiles.handicap already exists (from 001_profiles.sql).
-- This adds a per-trip handicap column to trip_members.
-- Safe to run multiple times (idempotent).
-- No existing data is affected.
-- =============================================================================

-- ── playing_handicap on trip_members ─────────────────────────────────────────
-- Stores the handicap a player uses for THIS trip specifically.
-- NULL means not yet captured (distinguish from 0 which is a real handicap).
-- profiles.handicap is the player's permanent default.

ALTER TABLE public.trip_members
  ADD COLUMN IF NOT EXISTS playing_handicap DECIMAL(4,1) NULL;

-- ── Verify ────────────────────────────────────────────────────────────────────
-- SELECT COUNT(*) FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'trip_members'
--   AND column_name = 'playing_handicap';
-- -- MUST BE 1
