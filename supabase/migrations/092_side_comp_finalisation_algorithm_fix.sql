-- =============================================================================
-- 092_side_comp_finalisation_algorithm_fix.sql
-- =============================================================================
-- CRITICAL FIX, found during a Side Game winner algorithm audit (7 Oct).
--
-- ROOT CAUSE, confirmed by reading the actual write paths, not assumed:
-- public.side_comp_lead_changes is written to EXCLUSIVELY for
-- comp_type = 'longest_drive' (confirmed in
-- src/app/api/trips/[tripId]/side-comps/[sideCompId]/entries/route.ts --
-- the 'nearest_pin'/'pros_approach' branch calls
-- submit_side_comp_value_entry(), whose full body (migration 078, the
-- current authoritative definition) only ever INSERTs into
-- side_comp_entries, never into side_comp_lead_changes).
--
-- The previous finalize_side_comp_winners() (080, hardened in 082)
-- determines every Side Game's winner EXCLUSIVELY from
-- side_comp_lead_changes, with no branch by comp_type at all. The
-- practical consequence: for every comp_type other than
-- 'longest_drive' (nearest_pin, pros_approach, and the inactive
-- best_on_day/custom), that table is always empty for that
-- competition, so the function's own CTEs find zero rows and
-- official_winner_entry_id is NEVER set -- not "a possibly different
-- winner," but a guaranteed, permanent failure to ever finalise these
-- competition types, for any event, at any time, regardless of how
-- many valid results exist or how many times the round is closed.
--
-- This also surfaced a second, subtler pre-existing gap: the previous
-- longest_drive path took the single most recent lead-change row
-- unconditionally, with no qualified/verified check at all -- unlike
-- the live Side Games screen (computeRoundSideGames.ts), which walks
-- backward through lead changes specifically to skip any whose entry
-- isn't qualified+verified. Fixed as part of the same change (see
-- longest_drive_winner below), since it's the same category of bug:
-- official finalisation silently diverging from what the live screen
-- already shows players as the winner.
--
-- FIX: finalize_side_comp_winners() now branches by comp_type,
-- mirroring computeRoundSideGames.ts's own winner-determination logic
-- exactly, so the live screen and the official result can no longer
-- structurally diverge:
--   - longest_drive: the most recent side_comp_lead_changes row whose
--     joined side_comp_entries row is qualified AND verified (the
--     qualified/verified filter is applied via the JOIN itself, before
--     DISTINCT ON picks the latest by sequence_number -- so a
--     disqualified/unverified later lead change is transparently
--     skipped in favour of the next most recent valid one, exactly
--     matching the live screen's own backward walk).
--   - every other comp_type (nearest_pin, pros_approach, and anything
--     else that isn't 'powerplay'): the qualified+verified entry with
--     the best (lowest) result_value directly from side_comp_entries --
--     exactly mirroring computeRoundSideGames.ts's own "else" branch.
--     A final `sce.id ASC` tiebreaker is added purely for SQL
--     determinism/idempotency (so a re-run always picks the same row);
--     it is not a claimed business rule, since neither the live screen
--     nor the previous SQL ever defined one for a true tie.
--   - 'powerplay': unchanged -- it was never finalised by this
--     function before (no lead changes, no comparable result_value
--     semantics) and still isn't; computeRoundSideGames.ts itself
--     never produces a `winner` for powerplay either (only
--     powerplayBest, a different, separate concept), so there is
--     nothing to mirror here and no behaviour to add.
--
-- Nothing about WHO counts as a winner for a given valid dataset is a
-- new business decision -- this migration makes the official
-- finalisation function compute winners using the exact same rules
-- the live Side Games screen already uses and already shows to
-- players and organisers. The existing idempotency guard
-- (`WHERE official_winner_entry_id IS NULL`) is preserved unchanged,
-- so this remains safe to call repeatedly, exactly as before.
--
-- SCORING: unchanged. This does not touch event/round scoring,
-- stableford points, or final standings in any way -- it is strictly
-- the Side Game winner-determination algorithm.
--
-- HISTORICAL DATA: see the delivery report for this pass for the full
-- risk assessment. In short: every non-longest_drive Side Game across
-- every event to date has official_winner_entry_id = NULL (it could
-- never have been set by the old function), so there is no incorrect
-- historical WINNER to reconcile for those types -- only a MISSING
-- one, which this fix allows to populate going forward exactly like
-- any other previously-unfinalised Side Game already does (self-
-- healing via get_my_golf_summary(), or a fresh Event Memories load
-- of the V1.12 slideshow fallback, or an explicit finalisation call).
-- No existing official_winner_entry_id value is overwritten or
-- cleared by this migration -- it only changes what a FUTURE call to
-- finalize_side_comp_winners() computes for rows that are still NULL.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.finalize_side_comp_winners(p_round_id UUID)
RETURNS TABLE (side_comp_id UUID, winner_entry_id UUID, winner_player_id UUID)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH
  -- longest_drive -- unchanged winner concept (most recent qualifying
  -- lead change), now with the qualified/verified filter the live
  -- screen already applies, via the JOIN below, before DISTINCT ON
  -- picks the latest by sequence_number.
  longest_drive_winner AS (
    SELECT DISTINCT ON (lc.side_comp_id)
      lc.side_comp_id, lc.player_id, sce.id AS entry_id
    FROM public.side_comp_lead_changes lc
    JOIN public.side_comps sc
      ON sc.id = lc.side_comp_id AND sc.round_id = p_round_id AND sc.comp_type = 'longest_drive'
    JOIN public.side_comp_entries sce
      ON sce.side_comp_id = lc.side_comp_id AND sce.player_id = lc.player_id
     AND sce.qualified = true AND sce.verification_status = 'verified'
    ORDER BY lc.side_comp_id, lc.sequence_number DESC
  ),
  -- Every other comp_type except 'powerplay' (nearest_pin,
  -- pros_approach, and anything else that may exist) -- best (lowest)
  -- qualifying/verified result_value, exactly mirroring
  -- computeRoundSideGames.ts's own "else" branch. The sce.id ASC
  -- tiebreaker exists only for determinism on a true tie; it is not a
  -- claimed business rule.
  value_based_winner AS (
    SELECT DISTINCT ON (sce.side_comp_id)
      sce.side_comp_id, sce.player_id, sce.id AS entry_id
    FROM public.side_comp_entries sce
    JOIN public.side_comps sc
      ON sc.id = sce.side_comp_id AND sc.round_id = p_round_id
     AND sc.comp_type NOT IN ('longest_drive', 'powerplay')
    WHERE sce.qualified = true AND sce.verification_status = 'verified' AND sce.result_value IS NOT NULL
    ORDER BY sce.side_comp_id, sce.result_value ASC, sce.id ASC
  ),
  winning_entry AS (
    SELECT side_comp_id, player_id, entry_id FROM longest_drive_winner
    UNION ALL
    SELECT side_comp_id, player_id, entry_id FROM value_based_winner
  ),
  updated AS (
    UPDATE public.side_comps sc
    SET official_winner_entry_id = we.entry_id, finalised_at = now()
    FROM winning_entry we
    WHERE sc.id = we.side_comp_id
      AND sc.round_id = p_round_id
      AND sc.official_winner_entry_id IS NULL  -- the idempotency guard itself, preserved unchanged
    RETURNING sc.id, sc.official_winner_entry_id
  )
  SELECT u.id, u.official_winner_entry_id, we.player_id
  FROM updated u
  JOIN winning_entry we ON we.side_comp_id = u.id;
END;
$$;

NOTIFY pgrst, 'reload schema';
