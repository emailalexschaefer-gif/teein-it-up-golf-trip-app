-- =============================================================================
-- 051_no_qualify_auto_verified.sql
-- =============================================================================
-- Package 1 fix: "A player answering No to NTP must create no claim and
-- no verification request."
--
-- Root cause: both submission RPCs always inserted verification_status
-- = 'pending' with a required_verifier_id assigned, regardless of
-- p_qualified. Answering "No" (didn't hit the green / didn't hit the
-- fairway) is a self-evident, unambiguous fact — there's nothing for a
-- marker to confirm, correct, or reject about a player saying they
-- missed. Despite that, it was showing up in the marker's pending-
-- verification list identically to a real distance claim.
--
-- Fix: when p_qualified is false, the entry is inserted already
-- verification_status = 'verified' (self-attested — verified_by =
-- p_entered_by, verified_at = now()), with required_verifier_id left
-- NULL. Nothing pending is created; nothing appears on any marker's
-- verification list; no claim is made in the first place, matching the
-- required behaviour exactly. A qualifying claim (p_qualified = true)
-- is completely unaffected — same pending-and-requires-verification
-- path as migration 047 always had.
--
-- Also fixes the resubmission branch: if a player who previously
-- answered Yes (pending or verified) later changes their answer to No,
-- the entry correctly flips to auto-verified/not-qualified rather than
-- staying pending or keeping a stale required_verifier_id.
--
-- CREATE OR REPLACE only — neither function's signature nor RETURNS
-- TABLE shape changes.
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
