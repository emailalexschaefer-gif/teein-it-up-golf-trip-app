-- =============================================================================
-- 078_side_comp_verifier_production_repair.sql
-- =============================================================================
-- CONSOLIDATED PRODUCTION REPAIR -- P0 shared-device Side Games (8 Sep)
--
-- Audited every migration touching side_comp_entries, verifier_source,
-- resolve_side_comp_verifier(), or side-game submission (037, 038, 045,
-- 047, 049, 050, 051, 071, 072, 076) to build this. Full chain summary:
--
--   037 -- creates side_comp_entries (base table). REQUIRED (prerequisite
--         table), unrelated to the verifier_source bug itself.
--   038 -- original submit_side_comp_value_entry/submit_longest_drive_entry,
--         before verifier_source existed. SUPERSEDED by 047.
--   045 -- unrelated trigger fix (cascade-delete lock). Not part of this
--         chain at all -- safe to ignore for this repair.
--   047 -- adds verifier_source column + ORIGINAL 3-value CHECK
--         constraint, original resolve_side_comp_verifier, redeclares
--         both submit_* RPCs to use it. REQUIRED (creates the column and
--         constraint this repair updates) but its function bodies are
--         SUPERSEDED by 051/071 below.
--   049 -- redeclares submit_side_comp_value_entry (ambiguity fix).
--         SUPERSEDED by 050, then 051. SAFE TO RERUN, not required if
--         051 has run.
--   050 -- redeclares submit_side_comp_value_entry again. SUPERSEDED by
--         051. SAFE TO RERUN, not required if 051 has run.
--   051 -- LATEST submit_side_comp_value_entry AND
--         submit_longest_drive_entry. REQUIRED -- this repair
--         reproduces both bodies exactly, verbatim, from this file.
--   071 -- LATEST resolve_side_comp_verifier -- introduces the
--         'shared_device_partner' tier. REQUIRED -- this repair
--         reproduces this body exactly, verbatim, from this file.
--   072 -- unrelated RLS fix on a backup table. Not part of this chain.
--   076 -- the CHECK constraint fix this whole P0 depends on. REQUIRED
--         -- reproduced at the end of this repair.
--
-- WHAT THIS SCRIPT DOES: re-applies the LATEST, CURRENT-REPO version of
-- every piece in the required chain (051's two RPCs, 071's resolver,
-- 076's constraint), in the correct order, as ONE idempotent script.
-- Every statement is CREATE OR REPLACE FUNCTION or
-- DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT -- none of them touch,
-- delete, or move any existing row in side_comp_entries or any other
-- table. Safe to run regardless of which subset of the above has
-- already been applied to production, and safe to run more than once.
--
-- Run this entire script in the Supabase SQL Editor in one execution.
-- =============================================================================

-- Step 1: Ensure the base column exists (idempotent; matches 047).
ALTER TABLE public.side_comp_entries
  ADD COLUMN IF NOT EXISTS verifier_source TEXT;

-- Step 2: resolve_side_comp_verifier() -- latest body, verbatim from 071.
CREATE OR REPLACE FUNCTION public.resolve_side_comp_verifier(
  p_round_id UUID, p_trip_id UUID, p_player_id UUID
) RETURNS TABLE (verifier_id UUID, verifier_source TEXT)
LANGUAGE plpgsql AS $$
DECLARE
  v_marker_id       UUID;
  v_organiser_id    UUID;
  v_claimant_group  UUID;
  v_shared_device_partner UUID;
  v_other_player    UUID;
BEGIN
  SELECT marker_player_id INTO v_marker_id
    FROM public.round_markers WHERE round_id = p_round_id AND player_id = p_player_id;

  IF v_marker_id IS NOT NULL THEN
    RETURN QUERY SELECT v_marker_id, 'marker'::TEXT;
    RETURN;
  END IF;

  -- Shared-device pairing — checked before the organiser/cross-group
  -- fallbacks, exactly matching how live scoring itself already
  -- prioritises shared-device detection over a round_markers lookup
  -- (see resolveMarkedPlayerId, sharedDeviceScoring.ts). A Paper
  -- player never has a round_markers row at all, so without this
  -- check they always fell straight through to the fallbacks below.
  SELECT tm.group_id INTO v_claimant_group
    FROM public.trip_members tm WHERE tm.trip_id = p_trip_id AND tm.profile_id = p_player_id;

  IF v_claimant_group IS NOT NULL THEN
    SELECT sc.player_id INTO v_shared_device_partner
      FROM public.scorecards sc
      JOIN public.trip_members tm ON tm.trip_id = p_trip_id AND tm.profile_id = sc.player_id
      WHERE sc.round_id = p_round_id AND tm.group_id = v_claimant_group AND sc.status <> 'withdrawn'
        AND sc.player_id <> p_player_id
      -- Exactly 1 digital + 1 paper in this group is the same rule
      -- detectSharedDeviceGroup enforces — this only matches when the
      -- claimant's own scoring_method genuinely differs from the
      -- candidate's, in a group of exactly two.
      AND sc.scoring_method <> (SELECT scoring_method FROM public.scorecards WHERE round_id = p_round_id AND player_id = p_player_id)
      AND (SELECT COUNT(*) FROM public.scorecards sc2
             JOIN public.trip_members tm2 ON tm2.trip_id = p_trip_id AND tm2.profile_id = sc2.player_id
             WHERE sc2.round_id = p_round_id AND tm2.group_id = v_claimant_group AND sc2.status <> 'withdrawn') = 2;

    IF v_shared_device_partner IS NOT NULL THEN
      RETURN QUERY SELECT v_shared_device_partner, 'shared_device_partner'::TEXT;
      RETURN;
    END IF;
  END IF;

  SELECT profile_id INTO v_organiser_id
    FROM public.trip_members WHERE trip_id = p_trip_id AND role = 'organiser' LIMIT 1;

  IF v_organiser_id IS NOT NULL AND v_organiser_id <> p_player_id THEN
    RETURN QUERY SELECT v_organiser_id, 'organiser_fallback'::TEXT;
    RETURN;
  END IF;

  -- Scoped to the claimant's own playing group — was scoped to the
  -- entire round, which is the actual bug this migration fixes.
  SELECT sc.player_id INTO v_other_player
    FROM public.scorecards sc
    JOIN public.trip_members tm ON tm.trip_id = p_trip_id AND tm.profile_id = sc.player_id
    WHERE sc.round_id = p_round_id AND sc.player_id <> p_player_id AND sc.status <> 'withdrawn'
      AND v_claimant_group IS NOT NULL AND tm.group_id = v_claimant_group
    ORDER BY sc.player_id LIMIT 1;

  IF v_other_player IS NOT NULL THEN
    RETURN QUERY SELECT v_other_player, 'organiser_fallback'::TEXT; -- still "no marker" fallback, just resolved to a co-player rather than the claimant themselves
    RETURN;
  END IF;

  RETURN QUERY SELECT p_player_id, 'self_verified_fallback'::TEXT; -- genuinely nobody else — rare, explicitly flagged, never silent
END;
$$;

NOTIFY pgrst, 'reload schema';

-- Step 3: submit_side_comp_value_entry / submit_longest_drive_entry --
--         latest bodies, verbatim from 051.
CREATE OR REPLACE FUNCTION public.submit_side_comp_value_entry(
  p_side_comp_id UUID,
  p_player_id    UUID,
  p_qualified    BOOLEAN,
  p_result_value NUMERIC,
  p_entered_by   UUID
) RETURNS TABLE (
  entry_id UUID, verification_status TEXT, would_lead_if_verified BOOLEAN,
  required_verifier_id UUID, verifier_source TEXT,
  current_leader_player_id UUID, current_leader_name TEXT, current_leader_value NUMERIC
) LANGUAGE plpgsql AS $$
DECLARE
  v_round_id      UUID;
  v_trip_id       UUID;
  v_round_status  TEXT;
  v_entry_id      UUID;
  v_prior_status  TEXT;
  v_best_verified NUMERIC;
  v_would_lead    BOOLEAN := false;
  v_verifier_id   UUID;
  v_verifier_src  TEXT;
  v_leader_row    RECORD;
  v_status        TEXT;
BEGIN
  SELECT round_id, trip_id INTO v_round_id, v_trip_id FROM public.side_comps WHERE id = p_side_comp_id FOR UPDATE;
  IF v_round_id IS NULL THEN
    RAISE EXCEPTION 'Side competition not found.';
  END IF;

  SELECT status INTO v_round_status FROM public.rounds WHERE id = v_round_id;
  IF v_round_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'This round is not currently active.';
  END IF;

  IF NOT p_qualified THEN
    p_result_value := NULL;
  ELSIF p_result_value IS NULL OR p_result_value <= 0 THEN
    RAISE EXCEPTION 'A qualifying result requires a positive distance.';
  END IF;

  SELECT sce.verification_status INTO v_prior_status
    FROM public.side_comp_entries sce WHERE side_comp_id = p_side_comp_id AND player_id = p_player_id;

  IF v_prior_status IS NULL OR v_prior_status <> 'pending' THEN
    SELECT verifier_id, resolve_side_comp_verifier.verifier_source
      INTO v_verifier_id, v_verifier_src
      FROM public.resolve_side_comp_verifier(v_round_id, v_trip_id, p_player_id);
  END IF;

  -- A "No" answer is self-evident, nothing to verify — auto-verified
  -- immediately, no marker involved, no required_verifier_id.
  v_status := CASE WHEN p_qualified THEN 'pending' ELSE 'verified' END;
  IF NOT p_qualified THEN
    v_verifier_id := NULL;
    v_verifier_src := NULL;
  END IF;

  INSERT INTO public.side_comp_entries
    (side_comp_id, player_id, qualified, result_value, claimed_value, entered_by,
     verification_status, required_verifier_id, verifier_source, verified_by, verified_at)
  VALUES
    (p_side_comp_id, p_player_id, p_qualified, NULL, p_result_value, p_entered_by,
     v_status, v_verifier_id, v_verifier_src,
     CASE WHEN p_qualified THEN NULL ELSE p_entered_by END,
     CASE WHEN p_qualified THEN NULL ELSE now() END)
  ON CONFLICT (side_comp_id, player_id) DO UPDATE SET
    qualified = EXCLUDED.qualified,
    claimed_value = EXCLUDED.claimed_value,
    updated_at = now(),
    result_value = CASE
      WHEN NOT EXCLUDED.qualified THEN NULL
      WHEN side_comp_entries.verification_status = 'pending' THEN side_comp_entries.result_value
      ELSE NULL END,
    verification_status = EXCLUDED.verification_status,
    required_verifier_id = CASE
      WHEN NOT EXCLUDED.qualified THEN NULL
      WHEN side_comp_entries.verification_status = 'pending' THEN side_comp_entries.required_verifier_id
      ELSE EXCLUDED.required_verifier_id END,
    verifier_source = CASE
      WHEN NOT EXCLUDED.qualified THEN NULL
      WHEN side_comp_entries.verification_status = 'pending' THEN side_comp_entries.verifier_source
      ELSE EXCLUDED.verifier_source END,
    verified_by = CASE
      WHEN NOT EXCLUDED.qualified THEN EXCLUDED.verified_by
      WHEN side_comp_entries.verification_status = 'pending' THEN side_comp_entries.verified_by
      ELSE NULL END,
    verified_at = CASE
      WHEN NOT EXCLUDED.qualified THEN EXCLUDED.verified_at
      WHEN side_comp_entries.verification_status = 'pending' THEN side_comp_entries.verified_at
      ELSE NULL END
  RETURNING id, side_comp_entries.required_verifier_id, side_comp_entries.verifier_source, side_comp_entries.verification_status
    INTO v_entry_id, v_verifier_id, v_verifier_src, v_status;

  SELECT MIN(sce.result_value) INTO v_best_verified
    FROM public.side_comp_entries sce
    WHERE sce.side_comp_id = p_side_comp_id AND sce.verification_status = 'verified'
      AND sce.result_value IS NOT NULL AND sce.player_id <> p_player_id;

  v_would_lead := p_qualified AND (v_best_verified IS NULL OR p_result_value < v_best_verified);

  SELECT sce.player_id, pr.full_name, sce.result_value
    INTO v_leader_row
    FROM public.side_comp_entries sce JOIN public.profiles pr ON pr.id = sce.player_id
    WHERE sce.side_comp_id = p_side_comp_id AND sce.verification_status = 'verified' AND sce.result_value IS NOT NULL
    ORDER BY sce.result_value ASC LIMIT 1;

  RETURN QUERY SELECT v_entry_id, v_status, v_would_lead,
    v_verifier_id, v_verifier_src,
    v_leader_row.player_id, v_leader_row.full_name, v_leader_row.result_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_longest_drive_entry(
  p_side_comp_id     UUID,
  p_player_id        UUID,
  p_qualified        BOOLEAN,
  p_claims_beat_lead  BOOLEAN,
  p_entered_by       UUID
) RETURNS TABLE (
  entry_id UUID, verification_status TEXT, would_lead_if_verified BOOLEAN,
  required_verifier_id UUID, verifier_source TEXT,
  current_leader_player_id UUID, current_leader_name TEXT
) LANGUAGE plpgsql AS $$
DECLARE
  v_round_id      UUID;
  v_trip_id       UUID;
  v_round_status  TEXT;
  v_entry_id      UUID;
  v_prior_status  TEXT;
  v_would_lead    BOOLEAN := false;
  v_verifier_id   UUID;
  v_verifier_src  TEXT;
  v_leader_row    RECORD;
  v_status        TEXT;
BEGIN
  SELECT round_id, trip_id INTO v_round_id, v_trip_id FROM public.side_comps WHERE id = p_side_comp_id FOR UPDATE;
  IF v_round_id IS NULL THEN
    RAISE EXCEPTION 'Side competition not found.';
  END IF;

  SELECT status INTO v_round_status FROM public.rounds WHERE id = v_round_id;
  IF v_round_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'This round is not currently active.';
  END IF;

  SELECT sce.verification_status INTO v_prior_status
    FROM public.side_comp_entries sce WHERE side_comp_id = p_side_comp_id AND player_id = p_player_id;

  IF v_prior_status IS NULL OR v_prior_status <> 'pending' THEN
    SELECT verifier_id, resolve_side_comp_verifier.verifier_source
      INTO v_verifier_id, v_verifier_src
      FROM public.resolve_side_comp_verifier(v_round_id, v_trip_id, p_player_id);
  END IF;

  v_status := CASE WHEN p_qualified THEN 'pending' ELSE 'verified' END;
  IF NOT p_qualified THEN
    v_verifier_id := NULL;
    v_verifier_src := NULL;
  END IF;

  INSERT INTO public.side_comp_entries
    (side_comp_id, player_id, qualified, result_value, claimed_value, claimed_beat_leader, entered_by,
     verification_status, required_verifier_id, verifier_source, verified_by, verified_at)
  VALUES
    (p_side_comp_id, p_player_id, p_qualified, NULL, NULL, p_claims_beat_lead, p_entered_by,
     v_status, v_verifier_id, v_verifier_src,
     CASE WHEN p_qualified THEN NULL ELSE p_entered_by END,
     CASE WHEN p_qualified THEN NULL ELSE now() END)
  ON CONFLICT (side_comp_id, player_id) DO UPDATE SET
    qualified = EXCLUDED.qualified,
    claimed_beat_leader = EXCLUDED.claimed_beat_leader,
    updated_at = now(),
    result_value = CASE WHEN side_comp_entries.verification_status = 'pending' THEN side_comp_entries.result_value ELSE NULL END,
    verification_status = EXCLUDED.verification_status,
    required_verifier_id = CASE
      WHEN NOT EXCLUDED.qualified THEN NULL
      WHEN side_comp_entries.verification_status = 'pending' THEN side_comp_entries.required_verifier_id
      ELSE EXCLUDED.required_verifier_id END,
    verifier_source = CASE
      WHEN NOT EXCLUDED.qualified THEN NULL
      WHEN side_comp_entries.verification_status = 'pending' THEN side_comp_entries.verifier_source
      ELSE EXCLUDED.verifier_source END,
    verified_by = CASE
      WHEN NOT EXCLUDED.qualified THEN EXCLUDED.verified_by
      WHEN side_comp_entries.verification_status = 'pending' THEN side_comp_entries.verified_by
      ELSE NULL END,
    verified_at = CASE
      WHEN NOT EXCLUDED.qualified THEN EXCLUDED.verified_at
      WHEN side_comp_entries.verification_status = 'pending' THEN side_comp_entries.verified_at
      ELSE NULL END
  RETURNING id, side_comp_entries.required_verifier_id, side_comp_entries.verifier_source, side_comp_entries.verification_status
    INTO v_entry_id, v_verifier_id, v_verifier_src, v_status;

  SELECT lc.player_id, pr.full_name INTO v_leader_row
    FROM public.side_comp_lead_changes lc
    JOIN public.side_comp_entries sce ON sce.side_comp_id = lc.side_comp_id AND sce.player_id = lc.player_id
    JOIN public.profiles pr ON pr.id = lc.player_id
    WHERE lc.side_comp_id = p_side_comp_id AND sce.verification_status = 'verified' AND sce.qualified = true
    ORDER BY lc.sequence_number DESC LIMIT 1;

  IF p_qualified THEN
    IF v_leader_row.player_id IS NULL THEN
      v_would_lead := true;
    ELSIF v_leader_row.player_id <> p_player_id AND p_claims_beat_lead IS TRUE THEN
      v_would_lead := true;
    END IF;
  END IF;

  RETURN QUERY SELECT v_entry_id, v_status, v_would_lead,
    v_verifier_id, v_verifier_src,
    v_leader_row.player_id, v_leader_row.full_name;
END;
$$;

-- Step 4: THE FIX -- verifier_source CHECK constraint, verbatim from 076.
ALTER TABLE public.side_comp_entries
  DROP CONSTRAINT IF EXISTS side_comp_entries_verifier_source_check;

ALTER TABLE public.side_comp_entries
  ADD CONSTRAINT side_comp_entries_verifier_source_check
  CHECK (verifier_source IN ('marker', 'organiser_fallback', 'self_verified_fallback', 'shared_device_partner'));

NOTIFY pgrst, 'reload schema';

-- Step 5: Verification query -- run this after the script above to confirm.
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.side_comp_entries'::regclass
--   AND conname = 'side_comp_entries_verifier_source_check';
-- Expected result must include 'shared_device_partner'.
