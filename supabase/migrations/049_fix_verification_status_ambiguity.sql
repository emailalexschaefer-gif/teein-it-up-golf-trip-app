-- =============================================================================
-- 049_fix_verification_status_ambiguity.sql
-- =============================================================================
-- Hotfix for a real, confirmed production bug caught via live Vercel logs:
--
--   submit_side_comp_value_entry failed
--   error: column reference "verification_status" is ambiguous
--
-- Root cause: both submit_side_comp_value_entry and verify_side_comp_value_entry
-- declare RETURNS TABLE (..., verification_status TEXT, ...), which makes
-- verification_status an implicitly-visible identifier throughout the
-- function body — colliding with the actual side_comp_entries.verification_status
-- column whenever referenced unqualified inside a plain WHERE/SELECT (as
-- opposed to an UPDATE ... SET target, or a reference already qualified
-- with a table alias — both unambiguous under Postgres's own rules).
--
-- Three genuine unqualified references were found and fixed:
--   - submit_side_comp_value_entry: the would_lead_if_verified comparison
--     query. Runs on every qualifying submission, fresh or resubmission —
--     exactly why the failure hit both a first-time claim and a resubmission
--     of an already-verified claim identically.
--   - verify_side_comp_value_entry: two occurrences (the old-leader check
--     before the update, the new-leader check after). Not yet triggered
--     live at the time of the report (submission was already failing
--     first), but would have broken verification the moment submission
--     was fixed — caught here rather than in a second live failure.
--
-- submit_longest_drive_entry and verify_longest_drive_entry were inspected
-- function-by-function and confirmed NOT affected — every verification_status
-- reference in both is either qualified with an alias or in unambiguous
-- UPDATE-target position.
--
-- Safe as CREATE OR REPLACE: neither function's parameter list nor RETURNS
-- TABLE shape changed — only WHERE-clause bodies were touched — so no DROP
-- FUNCTION is required first. This migration intentionally does NOT re-run
-- any of migration 047's schema (ALTER TABLE), the resolve_side_comp_verifier
-- function, the backward-compatibility backfill, or the two Longest Drive
-- functions — all of that already ran successfully in production and does
-- not need to run again. This is the minimal safe patch, not a re-run of
-- the historical migration.
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

  -- Re-resolve the verifier for a brand-new claim, or for a resubmission
  -- of a claim that had already been verified/rejected (a genuinely new
  -- claim cycle — the marker assignment may since have changed). A claim
  -- still sitting 'pending' keeps its already-snapshotted verifier
  -- rather than being silently reassigned mid-review.
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
    -- A resubmission of a still-pending claim only updates the claim
    -- itself (correcting a typo before anyone's reviewed it) — result_
    -- value/verified_by/verified_at/verifier fields are left exactly as
    -- they are in that case (all still NULL/unset for a pending row
    -- anyway). A resubmission of a previously verified/rejected claim
    -- starts a genuinely new pending cycle, with a freshly resolved
    -- verifier and every verification field reset.
    result_value = CASE WHEN side_comp_entries.verification_status = 'pending' THEN side_comp_entries.result_value ELSE NULL END,
    verification_status = 'pending',
    required_verifier_id = CASE WHEN side_comp_entries.verification_status = 'pending' THEN side_comp_entries.required_verifier_id ELSE EXCLUDED.required_verifier_id END,
    verifier_source = CASE WHEN side_comp_entries.verification_status = 'pending' THEN side_comp_entries.verifier_source ELSE EXCLUDED.verifier_source END,
    verified_by = CASE WHEN side_comp_entries.verification_status = 'pending' THEN side_comp_entries.verified_by ELSE NULL END,
    verified_at = CASE WHEN side_comp_entries.verification_status = 'pending' THEN side_comp_entries.verified_at ELSE NULL END
  RETURNING id, side_comp_entries.required_verifier_id, side_comp_entries.verifier_source
    INTO v_entry_id, v_verifier_id, v_verifier_src;

  -- would_lead_if_verified — compared only against OTHER players' already
  -- VERIFIED, official results. Never compared against anyone's pending
  -- claim (including this player's own prior pending value, if any).
  SELECT MIN(result_value) INTO v_best_verified
    FROM public.side_comp_entries
    WHERE side_comp_id = p_side_comp_id AND side_comp_entries.verification_status = 'verified'
      AND result_value IS NOT NULL AND player_id <> p_player_id;

  v_would_lead := p_qualified AND (v_best_verified IS NULL OR p_result_value < v_best_verified);

  -- Current OFFICIAL leader — unaffected by this submission (submission
  -- never writes an official result), shown for context only.
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

  -- Valid verifiers: the snapshotted required_verifier_id, or any trip
  -- organiser as a standing supervisory override (organisers already
  -- have broad "manage entries" authority elsewhere on this table via
  -- RLS — this mirrors that, it doesn't expand it).
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

  -- Same identity-based leadership-change detection as the original
  -- (pre-verification) submission RPC used, and for the same reason: a
  -- verifier re-confirming an already-verified value that's already the
  -- best must not log a duplicate leadership event.
  SELECT player_id INTO v_old_leader_id
    FROM public.side_comp_entries
    WHERE side_comp_id = v_side_comp_id AND side_comp_entries.verification_status = 'verified' AND result_value IS NOT NULL
    ORDER BY result_value ASC LIMIT 1;

  UPDATE public.side_comp_entries SET
    verification_status = 'verified', result_value = v_final_value,
    verified_by = p_verifier_id, verified_at = now()
    WHERE id = p_entry_id;

  SELECT player_id INTO v_new_leader_id
    FROM public.side_comp_entries
    WHERE side_comp_id = v_side_comp_id AND side_comp_entries.verification_status = 'verified' AND result_value IS NOT NULL
    ORDER BY result_value ASC LIMIT 1;

  v_became_leader := (v_new_leader_id = v_player_id) AND (v_new_leader_id IS DISTINCT FROM v_old_leader_id);

  IF v_became_leader THEN
    SELECT COALESCE(MAX(sequence_number), 0) + 1 INTO v_next_seq
      FROM public.side_comp_lead_changes WHERE side_comp_id = v_side_comp_id;
    -- moment_id carried forward from the entry — Stage 4's own review
    -- caught this: without it, a verified leadership event with a real
    -- linked photo would show no image in Golf Story, since that reads
    -- side_comp_lead_changes.moment_id, not the entry's own.
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
