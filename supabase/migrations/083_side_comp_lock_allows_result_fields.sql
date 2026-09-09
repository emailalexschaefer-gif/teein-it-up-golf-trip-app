-- =============================================================================
-- 083_side_comp_lock_allows_result_fields.sql
-- =============================================================================
-- P0 PRODUCTION RECOVERY (9 Sep) -- 080's own historical backfill failed
-- against the live database with:
--   ERROR: P0001: Side Competition configuration is locked once the
--   round has started.
--   CONTEXT: PL/pgSQL function enforce_round_config_lock() line 9
--
-- ROOT CAUSE, confirmed by reading the real, current trigger definition
-- directly (037, later narrowed by 045) before writing anything:
-- side_comps_lock_after_start fires BEFORE INSERT OR UPDATE on EVERY
-- column, with no column restriction, and enforce_round_config_lock()
-- unconditionally raises whenever the round's status isn't 'upcoming'
-- -- it has no concept of WHICH columns changed, only THAT a write was
-- attempted. 080's backfill calls finalize_side_comp_winners() for
-- completed rounds, whose own UPDATE (SET official_winner_entry_id =
-- ..., finalised_at = now()) is therefore indistinguishable, to this
-- trigger, from an organiser trying to edit competition config after
-- play started -- exactly the scenario the trigger exists to block.
-- This is not a new bug introduced by 080; it's 080 being the first
-- thing to ever legitimately need to write to side_comps after a round
-- starts.
--
-- Confirmed also: this function is used by exactly one trigger, on
-- exactly one table (side_comps) -- searched every migration for other
-- callers before touching the function's behaviour, so this fix cannot
-- have any effect anywhere else. Confirmed migration 045 already
-- narrowed this same trigger's scope to INSERT OR UPDATE (removing
-- DELETE, for an unrelated cascade-delete bug) -- the trigger
-- redeclared below matches that same, current, narrower scope exactly;
-- DELETE remains completely untouched by this migration.
--
-- FIX -- safer than an explicit whitelist of configuration columns,
-- per the brief's own "if there's a safer architecture, use it and
-- explain why": rather than enumerating every configuration column
-- (name, comp_type, hole_number, description, enabled, ...) and having
-- to remember to update that list if a future migration adds another
-- config column, this compares the ENTIRE row, with only the two
-- approved system-result fields (official_winner_entry_id,
-- finalised_at) explicitly subtracted out first via the jsonb `-`
-- operator. If everything else is identical, the write is a pure
-- result-finalisation write and is allowed even on a started/completed
-- round. Any change to any other column -- including one not yet
-- invented -- is still rejected exactly as before. INSERT is
-- completely unaffected (OLD is NULL for INSERT, so this comparison
-- never applies, and the exception still fires exactly as before for
-- any INSERT on a non-upcoming round).
--
-- SAFE TO RUN REGARDLESS OF 080's ACTUAL PARTIAL-APPLICATION STATE:
-- every statement below is idempotent (ADD COLUMN IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS). Run the
-- verification queries first if you want to know the exact prior
-- state, but this migration does not depend on knowing it -- it
-- reaches the same correct end state either way:
--   - if 080 fully rolled back (the likely outcome, if it ran as one
--     pasted script/transaction in the SQL editor): the ADD COLUMN and
--     CREATE FUNCTION statements below recreate everything from
--     scratch.
--   - if some part of 080 persisted: the IF NOT EXISTS / OR REPLACE
--     guards make re-running those statements a safe no-op, and only
--     the genuinely-missing piece (the backfill, which is what
--     actually failed) executes.
-- =============================================================================

-- --- 1. Fix the trigger function -------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_round_config_lock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_round_id UUID;
  v_status   TEXT;
BEGIN
  v_round_id := COALESCE(NEW.round_id, OLD.round_id);
  SELECT status INTO v_status FROM public.rounds WHERE id = v_round_id;

  IF v_status IS DISTINCT FROM 'upcoming' THEN
    -- Allow an UPDATE that changes ONLY the system-managed result
    -- fields (official_winner_entry_id, finalised_at) -- these exist
    -- specifically to be populated AFTER play, by
    -- finalize_side_comp_winners(). Comparing the row with both
    -- fields subtracted out first means this stays correct even if a
    -- future migration adds another configuration column and forgets
    -- to update this trigger -- there is no column allowlist here to
    -- fall out of date.
    IF TG_OP = 'UPDATE'
       AND (to_jsonb(NEW) - 'official_winner_entry_id' - 'finalised_at')
         = (to_jsonb(OLD) - 'official_winner_entry_id' - 'finalised_at')
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Side Competition configuration is locked once the round has started.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- --- 2. Redeclare the trigger, matching 045's current INSERT-OR-UPDATE-only
--        scope exactly -- DELETE remains untouched by this migration. -------
DROP TRIGGER IF EXISTS side_comps_lock_after_start ON public.side_comps;
CREATE TRIGGER side_comps_lock_after_start
  BEFORE INSERT OR UPDATE ON public.side_comps
  FOR EACH ROW EXECUTE FUNCTION public.enforce_round_config_lock();

-- --- 3. Idempotently ensure 080's schema exists, regardless of whether ------
--        080 itself persisted or fully rolled back. -------------------------
ALTER TABLE public.side_comps
  ADD COLUMN IF NOT EXISTS official_winner_entry_id UUID REFERENCES public.side_comp_entries(id) ON DELETE SET NULL;

ALTER TABLE public.side_comps
  ADD COLUMN IF NOT EXISTS finalised_at TIMESTAMPTZ;

COMMENT ON COLUMN public.side_comps.official_winner_entry_id IS
  'Set exactly once, when this competition''s round closes -- the verified entry that was the current leader at that moment. NULL means either the round has not closed yet, or it closed with no valid verified result. Never reassigned once set.';

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

-- --- 4. Retry the backfill -- this is the exact step that failed before, ---
--        now safe because the trigger fix above is already in place by
--        the time this statement runs. -------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.rounds WHERE status = 'completed' LOOP
    PERFORM public.finalize_side_comp_winners(r.id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
