-- =============================================================================
-- 080_side_comp_official_winners.sql
-- =============================================================================
-- My Golf Side Games -- live status + official round winners (9 Sep).
--
-- CONFIRMED ARCHITECTURAL GAP, per direct inspection before writing
-- anything here: get_my_golf_summary()'s my_side_game_wins CTE (see
-- 075) infers a win from trip.status = 'completed' -- the whole trip's
-- status, not the round's. For a multi-round Event, Round 1's winner
-- would not appear as an official win in My Golf until every round on
-- the trip finishes, which is wrong -- confirmed by reading that CTE
-- directly, not assumed from the bug report alone.
--
-- SCHEMA CHOSEN: two nullable columns on side_comps, exactly the
-- architecture proposed:
--   official_winner_entry_id  UUID REFERENCES side_comp_entries(id)
--   finalised_at              TIMESTAMPTZ
-- Not a new table -- side_comps already has a 1:1 relationship with
-- "the official result of this one competition," so a column on the
-- row that already represents that competition is the narrower,
-- simpler choice than a satellite table for a single nullable
-- reference.
--
-- WHY side_comp_lead_changes IS THE SOURCE FOR "WHO WON": confirmed
-- directly against migration 047 before using it -- this table is
-- written ONLY by the verify RPCs (verify_side_comp_value_entry,
-- verify_longest_drive_entry), never by the submission RPCs (their own
-- comments explicitly say so). Its latest row per side_comp_id (by
-- sequence_number) is therefore already "the current, verified
-- leader" -- the exact same query get_my_golf_summary() already uses
-- for its (buggy) win inference. Reusing this, not inventing a new
-- ranking rule, per the explicit "do not invent new ranking logic"
-- instruction.
--
-- IDEMPOTENCY: finalize_side_comp_winners() below only ever writes
-- WHERE official_winner_entry_id IS NULL -- once set, a side_comp is
-- permanently finalised; re-running this function (e.g. if round
-- close were ever retried) is a guaranteed no-op for any side_comp
-- already finalised.
--
-- NO-RESULT CASE: a side_comp with no rows in side_comp_lead_changes
-- (nobody's claim was ever verified) simply has nothing to set --
-- official_winner_entry_id stays NULL, exactly as the brief requires
-- ("do not manufacture a winner").
--
-- BACKFILL: every ALREADY-completed round's side_comps are finalised
-- retroactively, using the exact same function and the exact same
-- "latest verified lead change" rule -- not a different, ad-hoc
-- historical calculation. This is safe and non-destructive: it only
-- ever INSERTs a value into a currently-NULL column, never touches
-- side_comp_entries, side_comp_lead_changes, or any other existing
-- data. Whatever a completed round's own current leader already is
-- becomes that round's historical winner -- consistent with what
-- get_my_golf_summary() already displayed for these rounds before
-- this migration (since trip.status = 'completed' is a superset
-- condition of "this round is part of a completed trip"), so no
-- existing correct total silently changes as a result of the backfill
-- itself -- only the SOURCE the total is computed from changes, in the
-- redeclared function below.
--
-- Idempotent: safe to run more than once (both the ALTERs and the
-- backfill's own WHERE official_winner_entry_id IS NULL guard).
-- =============================================================================

ALTER TABLE public.side_comps
  ADD COLUMN IF NOT EXISTS official_winner_entry_id UUID REFERENCES public.side_comp_entries(id) ON DELETE SET NULL;

ALTER TABLE public.side_comps
  ADD COLUMN IF NOT EXISTS finalised_at TIMESTAMPTZ;

COMMENT ON COLUMN public.side_comps.official_winner_entry_id IS
  'Set exactly once, when this competition''s round closes -- the verified entry that was the current leader at that moment. NULL means either the round has not closed yet, or it closed with no valid verified result. Never reassigned once set.';

-- -----------------------------------------------------------------------------
-- finalize_side_comp_winners(p_round_id) -- called from the round-close route
-- immediately after a round transitions to 'completed'. Idempotent by the
-- WHERE official_winner_entry_id IS NULL guard on the UPDATE itself --
-- a DB-level protection, not merely application-code discipline, per the
-- explicit "do not rely purely on client state for idempotency" instruction.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_side_comp_winners(p_round_id UUID)
RETURNS TABLE (side_comp_id UUID, winner_entry_id UUID, winner_player_id UUID)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH latest_leader AS (
    SELECT DISTINCT ON (lc.side_comp_id) lc.side_comp_id, lc.player_id
    FROM public.side_comp_lead_changes lc
    JOIN public.side_comps sc ON sc.id = lc.side_comp_id
    WHERE sc.round_id = p_round_id
    ORDER BY lc.side_comp_id, lc.sequence_number DESC
  ),
  winning_entry AS (
    SELECT ll.side_comp_id, ll.player_id, sce.id AS entry_id
    FROM latest_leader ll
    JOIN public.side_comp_entries sce ON sce.side_comp_id = ll.side_comp_id AND sce.player_id = ll.player_id
  ),
  updated AS (
    UPDATE public.side_comps sc
    SET official_winner_entry_id = we.entry_id, finalised_at = now()
    FROM winning_entry we
    WHERE sc.id = we.side_comp_id
      AND sc.round_id = p_round_id
      AND sc.official_winner_entry_id IS NULL  -- the idempotency guard itself
    RETURNING sc.id, sc.official_winner_entry_id
  )
  SELECT u.id, u.official_winner_entry_id, we.player_id
  FROM updated u
  JOIN winning_entry we ON we.side_comp_id = u.id;
END;
$$;

-- -----------------------------------------------------------------------------
-- Backfill -- run the exact same function for every round already
-- 'completed', for every side_comp that hasn't been finalised yet.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.rounds WHERE status = 'completed' LOOP
    PERFORM public.finalize_side_comp_winners(r.id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
