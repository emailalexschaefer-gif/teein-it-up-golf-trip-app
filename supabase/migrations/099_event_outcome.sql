-- =============================================================================
-- 099_event_outcome.sql
-- =============================================================================
-- Post-Lappen requirement: cancelling a round, ending an event early and
-- declaring an overall champion are THREE separate decisions.
--
--   * cancelling a round     -> rounds.status = 'cancelled'   (097)
--   * ending an event early  -> trips.ended_early = true       (this file)
--   * declaring a champion   -> trips.champion_declared        (this file)
--
-- Existing events are unchanged: every existing row gets ended_early = false
-- and champion_declared = true, which is exactly how they behave today (a
-- completed event has a champion). Only an organiser choosing "End Event
-- Early" with "No overall champion" ever sets champion_declared = false.
--
-- trips.status stays the single terminal-state switch ('completed') that
-- unlocks Final Standings, Event Memories and the Event Presentation. An event
-- ended early WITHOUT a champion is still status 'completed'.
--
-- Adds columns only. No table is dropped or rewritten, no data is changed, no
-- RLS or permission change (trips keeps its existing policies).
--
-- Run order:  097_round_cancellation.sql  ->  098_shared_leaderboards.sql  ->
--             099_event_outcome.sql
-- The application tolerates 099 not being applied yet (it reads these columns
-- defensively and treats a missing column as "normal completion"); only the
-- End Event Early action needs it, and says so if it is missing.
--
-- ROLLBACK (first reinstate/reopen any event you ended early; the app then no
-- longer knows the outcome and every completed event would read as having a champion):
--   ALTER TABLE public.trips
--     DROP COLUMN IF EXISTS ended_early,
--     DROP COLUMN IF EXISTS champion_declared,
--     DROP COLUMN IF EXISTS ended_early_reason,
--     DROP COLUMN IF EXISTS ended_early_note,
--     DROP COLUMN IF EXISTS ended_early_at,
--     DROP COLUMN IF EXISTS ended_early_by;
-- =============================================================================

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS ended_early        BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS champion_declared  BOOLEAN     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ended_early_reason TEXT        NULL CHECK (ended_early_reason IN ('weather','safety','other')),
  ADD COLUMN IF NOT EXISTS ended_early_note   TEXT        NULL CHECK (char_length(ended_early_note) <= 200),
  ADD COLUMN IF NOT EXISTS ended_early_at     TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS ended_early_by     UUID        NULL REFERENCES public.profiles(id);
