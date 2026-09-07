-- =============================================================================
-- 074_trips_is_practice.sql
-- =============================================================================
-- Separate Solo Event Play from Practice Round Mode (5 Sep).
--
-- INSPECTED FIRST, per the explicit instruction:
--   - trips.event_type already exists (golf_trip/corporate_day/
--     charity_day/golf_society/bucks_weekend/other) — but this is a
--     DESCRIPTIVE label of what kind of real event this is, used
--     elsewhere for display/badging. It is not, and should not become,
--     a competitive-vs-non-competitive classification — overloading it
--     would conflate two genuinely different concepts (what KIND of
--     event vs whether it's a real event at all).
--   - No round-level "competition mode" or "non-competitive" flag
--     exists anywhere in the schema.
--   - Nothing suitable to reuse — this migration adds one new,
--     narrow, explicit column, exactly matching the brief's own
--     preferred naming.
--
-- is_practice — NOT NULL DEFAULT false. Every existing trip is
-- unambiguously a real Event (false) the moment this column appears;
-- nothing is silently reclassified. A trip is practice only when
-- explicitly created as one, through the new Practice Round entry
-- point — never inferred from group size, scoring_method, or any
-- other existing field, per the brief's own explicit "do not
-- overload" instruction.
--
-- Deliberately on trips, not rounds: a Practice Round in this
-- implementation is always a single-trip, single-round, single-player
-- concept — classifying at the trip level is the one place every
-- downstream competitive system (leaderboard, Makers & Breakers,
-- final-results/Event Winner, My Event Stories) already scopes its own
-- queries by trip_id, so one flag there is enough to gate every one of
-- them without touching their own calculation logic.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS is_practice BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.trips.is_practice IS
  'Explicit, narrow classification: true only for a Practice Round (self-scored, non-competitive, excluded from leaderboard/Event Winner/Makers & Breakers/Side Games/organiser metrics). Never inferred from group size or player count -- a one-player group inside a real Event keeps is_practice = false.';

NOTIFY pgrst, 'reload schema';
