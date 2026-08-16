-- =============================================================================
-- 050_fix_result_value_ambiguity.sql
-- =============================================================================
-- Hotfix for the CONFIRM action still failing ("Couldn't save this
-- verification. Please try again.") after migration 049.
--
-- Root cause: the exact same ambiguity bug class as 049 fixed for
-- verification_status, but for a second column — result_value. Both
-- submit_side_comp_value_entry and verify_side_comp_value_entry declare
-- RETURNS TABLE (..., result_value NUMERIC, ...) (verify) or reference it
-- via RETURN QUERY (submit), making result_value an implicitly-visible
-- identifier throughout the function body, colliding with
-- side_comp_entries.result_value in any unqualified WHERE/ORDER BY.
-- Migration 049 qualified every verification_status reference in these
-- functions but left result_value unqualified in the same blocks —
-- an incomplete fix for the same underlying problem, not a new one.
--
-- Every occurrence found and fixed, using the table alias pattern already
-- proven correct elsewhere in these same functions (e.g. verify_side_comp_
-- value_entry's own final leader lookup, which was never affected because
-- it already used sce.result_value throughout):
--   - submit_side_comp_value_entry: the would_lead_if_verified comparison
--     (MIN(result_value), result_value IS NOT NULL).
--   - verify_side_comp_value_entry: the old-leader check before the
--     update, and the new-leader check after — both run unconditionally
--     on every confirm/correct call (reject returns early before reaching
--     them, which is exactly why Reject appeared unaffected while Confirm
--     and Correct both failed identically).
--
-- verify_longest_drive_entry and submit_longest_drive_entry re-checked
-- against this same column specifically (not just re-trusting 049's
-- verification_status-only inspection) — result_value never appears
-- unqualified in either; Longest Drive has no numeric result_value
-- concept at all (always NULL by design), so there was nothing here to
-- collide with in the first place.
--
-- Safe as CREATE OR REPLACE, same reasoning as 049: no signature or
-- RETURNS TABLE shape change, only WHERE/ORDER BY bodies touched.
-- =============================================================================

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

  INSERT INTO public.side_comp_entries
    (side_comp_id, player_id, qualified, result_value, claimed_value, entered_by,
     verification_status, required_verifier_id, verifier_source)
  VALUES
    (p_side_comp_id, p_player_id, p_qualified, NULL, p_result_value, p_entered_by,
     'pending', v_verifier_id, v_verifier_src)
  ON CONFLICT (side_comp_id, player_id) DO UPDATE SET
    qualified = EXCLUDED.qualified,
    claimed_value = EXCLUDED.claimed_value,
    updated_at = now(),
    result_value = CASE WHEN side_comp_entries.verification_status = 'pending' THEN side_comp_entries.result_value ELSE NULL END,
    verification_status = 'pending',
    required_verifier_id = CASE WHEN side_comp_entries.verification_status = 'pending' THEN side_comp_entries.required_verifier_id ELSE EXCLUDED.required_verifier_id END,
    verifier_source = CASE WHEN side_comp_entries.verification_status = 'pending' THEN side_comp_entries.verifier_source ELSE EXCLUDED.verifier_source END,
    verified_by = CASE WHEN side_comp_entries.verification_status = 'pending' THEN side_comp_entries.verified_by ELSE NULL END,
    verified_at = CASE WHEN side_comp_entries.verification_status = 'pending' THEN side_comp_entries.verified_at ELSE NULL END
  RETURNING id, side_comp_entries.required_verifier_id, side_comp_entries.verifier_source
    INTO v_entry_id, v_verifier_id, v_verifier_src;

  -- Fixed here: result_value now explicitly qualified via alias, same as
  -- verification_status already was after 049. Both were ambiguous for
  -- the identical reason (both column names also appear in this
  -- function's own RETURNS TABLE / calling context).
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

  RETURN QUERY SELECT v_entry_id, 'pending'::TEXT, v_would_lead,
    v_verifier_id, v_verifier_src,
    v_leader_row.player_id, v_leader_row.full_name, v_leader_row.result_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_side_comp_value_entry(
  p_entry_id        UUID,
  p_verifier_id     UUID,
  p_decision        TEXT,     -- 'confirm' | 'correct' | 'reject'
  p_corrected_value NUMERIC   -- required only when p_decision = 'correct'
) RETURNS TABLE (
  entry_id UUID, verification_status TEXT, result_value NUMERIC, became_official_leader BOOLEAN,
  current_leader_player_id UUID, current_leader_name TEXT, current_leader_value NUMERIC,
  lead_change_id UUID
) LANGUAGE plpgsql AS $$
DECLARE
  v_side_comp_id   UUID;
  v_player_id      UUID;
  v_required_id    UUID;
  v_claimed_value  NUMERIC;
  v_moment_id      UUID;
  v_is_organiser   BOOLEAN;
  v_trip_id        UUID;
  v_final_value    NUMERIC;
  v_old_leader_id  UUID;
  v_new_leader_id  UUID;
  v_became_leader  BOOLEAN := false;
  v_lead_change_id UUID;
  v_next_seq       INTEGER;
  v_leader_row     RECORD;
BEGIN
  IF p_decision NOT IN ('confirm', 'correct', 'reject') THEN
    RAISE EXCEPTION 'Invalid verification decision.';
  END IF;

  SELECT sce.side_comp_id, sce.player_id, sce.required_verifier_id, sce.claimed_value, sce.moment_id
    INTO v_side_comp_id, v_player_id, v_required_id, v_claimed_value, v_moment_id
    FROM public.side_comp_entries sce WHERE sce.id = p_entry_id FOR UPDATE;
  IF v_side_comp_id IS NULL THEN
    RAISE EXCEPTION 'Side competition entry not found.';
  END IF;

  SELECT trip_id INTO v_trip_id FROM public.side_comps WHERE id = v_side_comp_id;
  SELECT public.is_trip_organiser(v_trip_id) INTO v_is_organiser;

  IF p_verifier_id <> v_required_id AND NOT v_is_organiser THEN
    RAISE EXCEPTION 'Only the assigned verifier or a trip organiser may verify this claim.';
  END IF;

  IF p_decision = 'reject' THEN
    UPDATE public.side_comp_entries SET
      verification_status = 'rejected', result_value = NULL,
      verified_by = p_verifier_id, verified_at = now()
      WHERE id = p_entry_id;
    RETURN QUERY SELECT p_entry_id, 'rejected'::TEXT, NULL::NUMERIC, false,
      NULL::UUID, NULL::TEXT, NULL::NUMERIC, NULL::UUID;
    RETURN;
  END IF;

  v_final_value := CASE WHEN p_decision = 'correct' THEN p_corrected_value ELSE v_claimed_value END;
  IF v_final_value IS NULL OR v_final_value <= 0 THEN
    RAISE EXCEPTION 'A verified result requires a positive distance.';
  END IF;

  -- Fixed here (this is the confirmed cause of the reported Confirm
  -- failure): result_value now explicitly qualified via alias — this
  -- block runs unconditionally on every confirm/correct call, which is
  -- exactly why the live report showed Confirm failing while Reject
  -- (which returns before ever reaching this point) did not.
  SELECT sce.player_id INTO v_old_leader_id
    FROM public.side_comp_entries sce
    WHERE sce.side_comp_id = v_side_comp_id AND sce.verification_status = 'verified' AND sce.result_value IS NOT NULL
    ORDER BY sce.result_value ASC LIMIT 1;

  UPDATE public.side_comp_entries SET
    verification_status = 'verified', result_value = v_final_value,
    verified_by = p_verifier_id, verified_at = now()
    WHERE id = p_entry_id;

  SELECT sce.player_id INTO v_new_leader_id
    FROM public.side_comp_entries sce
    WHERE sce.side_comp_id = v_side_comp_id AND sce.verification_status = 'verified' AND sce.result_value IS NOT NULL
    ORDER BY sce.result_value ASC LIMIT 1;

  v_became_leader := (v_new_leader_id = v_player_id) AND (v_new_leader_id IS DISTINCT FROM v_old_leader_id);

  IF v_became_leader THEN
    SELECT COALESCE(MAX(sequence_number), 0) + 1 INTO v_next_seq
      FROM public.side_comp_lead_changes WHERE side_comp_id = v_side_comp_id;
    INSERT INTO public.side_comp_lead_changes (side_comp_id, player_id, result_value, sequence_number, moment_id)
    VALUES (v_side_comp_id, v_player_id, v_final_value, v_next_seq, v_moment_id)
    RETURNING id INTO v_lead_change_id;
  END IF;

  SELECT sce.player_id, pr.full_name, sce.result_value INTO v_leader_row
    FROM public.side_comp_entries sce JOIN public.profiles pr ON pr.id = sce.player_id
    WHERE sce.side_comp_id = v_side_comp_id AND sce.verification_status = 'verified' AND sce.result_value IS NOT NULL
    ORDER BY sce.result_value ASC LIMIT 1;

  RETURN QUERY SELECT p_entry_id, 'verified'::TEXT, v_final_value, v_became_leader,
    v_leader_row.player_id, v_leader_row.full_name, v_leader_row.result_value,
    v_lead_change_id;
END;
$$;
