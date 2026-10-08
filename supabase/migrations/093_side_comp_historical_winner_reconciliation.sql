-- =============================================================================
-- 093_side_comp_historical_winner_reconciliation.sql
-- =============================================================================
-- ONE-TIME HISTORICAL BACKFILL, following the self-healing audit (7 Oct).
--
-- AUDIT FINDING, confirmed by reading every call site, not assumed:
-- public.get_my_golf_summary() is called from exactly one route,
-- /api/me/golf-summary (the "My Golf" player screen), and its own
-- self-healing reconciliation (added in 082) is additionally scoped to
-- ONLY that requesting player's own completed rounds
-- (`WHERE sc.player_id = p_player_id`). Event Memories never calls
-- get_my_golf_summary() at all -- confirmed directly, no such RPC call
-- exists anywhere in eventMemoryData.ts or its call chain. There is no
-- other route that calls it.
--
-- CONCLUSION: historical reconciliation is NOT guaranteed to happen
-- automatically for any given round. It only happens if and when a
-- specific player who had a scorecard in that round opens their own
-- My Golf screen after migration 092 is applied -- not triggered by
-- Event Memories, not triggered by any organiser-facing surface, and
-- not guaranteed to ever happen if no such player opens that screen.
-- Our real Round 2 is exactly this kind of case: completed before the
-- 092 fix, with valid nearest_pin/pros_approach results that the old
-- algorithm could never have finalised (see 092's own header comment
-- for the full root-cause trace).
--
-- FIX: this migration runs the EXACT SAME backfill pattern already
-- established in 080 (`FOR r IN SELECT id FROM rounds WHERE status =
-- 'completed' LOOP PERFORM finalize_side_comp_winners(r.id) END LOOP`)
-- -- no new logic, no new function, no new scoring rule. It simply
-- re-runs that backfill now that the function it calls has been
-- corrected by 092, so every historically-unfinalised Side Game
-- across every completed round (not just Round 2, and not special-
-- cased to any one event) gets the chance to resolve using the
-- correct, type-aware algorithm.
--
-- SAFETY, inherited entirely from finalize_side_comp_winners() itself,
-- not reimplemented here:
--   - NEVER overwrites a non-null official_winner_entry_id -- the
--     function's own idempotency guard (`WHERE official_winner_entry_id
--     IS NULL`) is untouched by 092 and applies here identically.
--   - NEVER reopens a round -- this only reads rounds.status, never
--     writes it.
--   - NEVER modifies scores or side_comp_entries -- the function only
--     ever writes to side_comps.official_winner_entry_id and
--     side_comps.finalised_at.
--   - NEVER fabricates a winner -- a Side Game with no qualifying
--     result still resolves to no matching row, exactly as it does for
--     a brand-new event.
--   - Does NOT touch Event Memories' own rule that a completed round's
--     NULL official state is authoritative until reconciled -- this
--     migration IS that reconciliation, run once, generically, for
--     every completed round, not a change to that rule.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.rounds WHERE status = 'completed' LOOP
    PERFORM public.finalize_side_comp_winners(r.id);
  END LOOP;
END $$;
