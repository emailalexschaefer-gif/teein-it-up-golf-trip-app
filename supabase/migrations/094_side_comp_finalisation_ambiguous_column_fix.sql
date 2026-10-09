-- =============================================================================
-- 094_side_comp_finalisation_ambiguous_column_fix.sql
-- =============================================================================
-- P0 HOTFIX for a production-only runtime failure surfaced while running
-- migration 093's historical backfill against the live database:
--
--   ERROR:  42702: column reference "side_comp_id" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--   CONTEXT: PL/pgSQL function finalize_side_comp_winners(uuid) line 3 at
--            RETURN QUERY
--
-- ROOT CAUSE, confirmed by reading the exact function body shipped in 092,
-- not assumed:
--
-- 092's CREATE OR REPLACE FUNCTION declares
--   RETURNS TABLE (side_comp_id UUID, winner_entry_id UUID, winner_player_id UUID)
-- which makes `side_comp_id` an implicit PL/pgSQL variable (the OUT
-- parameter for that output column), in scope for the entire function
-- body -- not just a column name.
--
-- The `winning_entry` CTE then does:
--   SELECT side_comp_id, player_id, entry_id FROM longest_drive_winner
--   UNION ALL
--   SELECT side_comp_id, player_id, entry_id FROM value_based_winner
--
-- Both `side_comp_id` references here are UNQUALIFIED. Postgres cannot
-- tell whether this means "the side_comp_id column produced by
-- longest_drive_winner/value_based_winner" or "the side_comp_id OUT
-- variable of the enclosing function" -- hence the ambiguous-column
-- error, raised the first time the statement actually executes (PL/pgSQL
-- validates embedded SQL lazily, on first run, which is exactly why
-- `CREATE OR REPLACE FUNCTION` itself succeeded in 092 and the break only
-- surfaced when 093's backfill loop actually called the function against
-- live data).
--
-- Every other column reference in 092's body is already table/CTE-
-- qualified (e.g. `lc.side_comp_id`, `sce.side_comp_id`, `u.id`,
-- `we.side_comp_id`) and is therefore NOT ambiguous -- a qualified
-- reference can only resolve to a column, never to a PL/pgSQL variable.
-- The one and only unqualified spot is the `winning_entry` CTE's own
-- SELECT list, confirmed by re-reading the full function body line by
-- line.
--
-- FIX: qualify every column in the `winning_entry` CTE's SELECT list by
-- its source CTE name. This is a pure syntax fix -- no business rule,
-- filter, join condition, ordering, or the idempotency guard changes in
-- any way. Winner determination logic is byte-for-byte identical to 092;
-- only the ambiguous unqualified references are now qualified.
--
-- Per project convention, 092 itself is NOT edited (it already shipped
-- and its CREATE OR REPLACE succeeded) -- this is a new forward
-- migration that re-applies CREATE OR REPLACE FUNCTION with the
-- corrected body. Safe to run any number of times.
--
-- NEXT STEP AFTER THIS MIGRATION: re-run 093's backfill. Migration 093
-- itself needs no change -- it only ever calls
-- `public.finalize_side_comp_winners(r.id)`, which will now execute
-- successfully.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.finalize_side_comp_winners(p_round_id UUID)
RETURNS TABLE (side_comp_id UUID, winner_entry_id UUID, winner_player_id UUID)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH
  -- longest_drive -- unchanged from 092: most recent qualifying lead
  -- change (qualified AND verified), via the JOIN filter before
  -- DISTINCT ON picks the latest by sequence_number.
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
  -- Every other comp_type except 'powerplay' -- unchanged from 092:
  -- best (lowest) qualifying/verified result_value, with sce.id ASC
  -- only as a determinism tiebreaker.
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
  -- THE FIX: every column below is now qualified by its source CTE
  -- name. In 092 these were unqualified (`side_comp_id, player_id,
  -- entry_id`), which made `side_comp_id` ambiguous against the
  -- function's own RETURNS TABLE column of the same name.
  winning_entry AS (
    SELECT longest_drive_winner.side_comp_id, longest_drive_winner.player_id, longest_drive_winner.entry_id
    FROM longest_drive_winner
    UNION ALL
    SELECT value_based_winner.side_comp_id, value_based_winner.player_id, value_based_winner.entry_id
    FROM value_based_winner
  ),
  updated AS (
    UPDATE public.side_comps sc
    SET official_winner_entry_id = we.entry_id, finalised_at = now()
    FROM winning_entry we
    WHERE sc.id = we.side_comp_id
      AND sc.round_id = p_round_id
      AND sc.official_winner_entry_id IS NULL  -- the idempotency guard itself, preserved unchanged from 080/092
    RETURNING sc.id, sc.official_winner_entry_id
  )
  SELECT u.id, u.official_winner_entry_id, we.player_id
  FROM updated u
  JOIN winning_entry we ON we.side_comp_id = u.id;
END;
$$;

NOTIFY pgrst, 'reload schema';
