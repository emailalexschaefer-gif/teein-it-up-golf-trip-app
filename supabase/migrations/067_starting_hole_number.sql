-- =============================================================================
-- 067_starting_hole_number.sql
-- =============================================================================
-- Starting Tee support (9/18 holes from the 1st or 10th tee).
--
-- The smallest additive field genuinely required for this feature —
-- confirmed by inspection first (per the explicit instruction) that
-- nothing in the existing round model already represents it:
-- start_type (migration 055) is Shotgun's own, deliberately separate
-- concept ('standard' | 'shotgun'), and round_group_starting_holes is
-- per-GROUP, not a single round-level value. Neither can stand in for
-- this.
--
-- starting_hole_number on rounds — a round-level property, not a
-- trip-level one (each round of a multi-round trip keeps its own
-- independent Starting Tee, per the explicit multi-round-safety
-- requirement). Only ever 1 or 10 — every other physical hole number
-- is a valid starting hole for Shotgun's per-group mechanism, but not
-- for this uniform, round-wide setting.
--
-- Backward compatible by construction: NOT NULL DEFAULT 1 means every
-- historical round, the instant this migration runs, is already
-- correctly configured as "starts at the 1st tee" — its exact current
-- behaviour, unchanged. No backfill logic needed, no historical rewrite
-- risk.
-- =============================================================================

ALTER TABLE public.rounds
  ADD COLUMN IF NOT EXISTS starting_hole_number INTEGER NOT NULL DEFAULT 1
    CHECK (starting_hole_number IN (1, 10));
