-- =============================================================================
-- 047_side_comp_verification.sql
-- =============================================================================
-- Side Game Marker Verification — Stage 1 (schema + RPC architecture).
--
-- Investigated first (see delivery notes): round_markers (migration 022)
-- is directional and per-round, resolved once here at claim time and
-- snapshotted — never re-derived later, so a subsequent marker
-- reassignment can't retroactively change who was responsible for an
-- already-submitted claim. Two legitimate configurations have no
-- player-marker at all ('individual' mode; a solo group within
-- 'self_and_marker' mode) — handled by the verifier-resolution hierarchy
-- below, never by inventing a fake round_markers row.
--
-- Core architectural shift: side_comp_lead_changes (the append-only
-- leadership history that drives Side Games/Golf Story/Final Results)
-- is no longer written at SUBMISSION time — only at VERIFICATION time.
-- result_value's meaning changes accordingly: it is now the OFFICIAL,
-- VERIFIED value only, NULL while a claim is pending or after rejection.
-- claimed_value (new) preserves exactly what the player originally
-- entered, forever, regardless of what happens afterward.
--
-- This is deliberately a minimal-disruption design: every existing
-- "current leader" query anywhere in the app already does
-- `WHERE qualified = true ORDER BY result_value ASC` — because
-- result_value is now NULL until verified, those queries correctly stop
-- surfacing pending claims as leaders WITHOUT needing to be rewritten to
-- know anything new about verification_status. (Stage 4 will still add
-- explicit `result_value IS NOT NULL` guards to those queries rather
-- than rely on Postgres's default NULLS-LAST ordering alone — noted
-- here, not done in this migration, which is schema/RPC only.)
--
-- Backward compatibility: every side_comp_entries row that existed
-- before this migration represents a genuine, already-trusted result —
-- none of that should retroactively become "pending" and vanish from
-- leaderboards/story. Backfilled explicitly below: verification_status
-- = 'verified', claimed_value = result_value (the only value that ever
-- existed for these rows), verified_by/verified_at left NULL (there is
-- no real verifier to attribute — a NULL here means "predates
-- verification", not "verified by nobody", and is a deliberate signal,
-- not a gap).
-- =============================================================================

-- ── 1. Schema ────────────────────────────────────────────────────────────────

ALTER TABLE public.side_comp_entries
  ADD COLUMN IF NOT EXISTS verification_status  TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  ADD COLUMN IF NOT EXISTS claimed_value         NUMERIC(6,2), -- exactly what the player entered; never modified after creation
  ADD COLUMN IF NOT EXISTS claimed_beat_leader   BOOLEAN, -- Longest Drive only: the player's own submission-time assertion, needed again at verification time (not just at submission) — see Stage 1 delivery notes for why this was added after an initial oversight
  ADD COLUMN IF NOT EXISTS required_verifier_id  UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS verifier_source       TEXT
    CHECK (verifier_source IN ('marker', 'organiser_fallback', 'self_verified_fallback')),
  ADD COLUMN IF NOT EXISTS verified_by           UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS verified_at           TIMESTAMPTZ;

-- Backward-compatibility backfill — every pre-existing row is trusted,
-- verified data. Only touches rows that predate this migration (those
-- with the just-applied DEFAULT 'pending' and no claimed_value yet).
UPDATE public.side_comp_entries
SET verification_status = 'verified', claimed_value = result_value
WHERE claimed_value IS NULL AND verification_status = 'pending';

-- ── 2. Verifier resolution — used by the submission RPCs below ──────────────
-- Hierarchy, resolved once per claim and snapshotted onto the row:
--   1. The claimant's designated round_markers marker for this round.
--   2. No marker (individual mode / solo group) -> the trip organiser,
--      unless the claimant IS the organiser.
--   3. Claimant is the organiser with no marker -> any other player with
--      an active scorecard in this round.
--   4. Nobody else at all (genuine solo round) -> the claimant verifies
--      their own claim, explicitly flagged via verifier_source so this
--      is never confused with normal marker verification.
-- Never creates a round_markers row — this is read-only against that
-- table, exactly as instructed.
CREATE OR REPLACE FUNCTION public.resolve_side_comp_verifier(
  p_round_id UUID, p_trip_id UUID, p_player_id UUID
) RETURNS TABLE (verifier_id UUID, verifier_source TEXT)
LANGUAGE plpgsql AS $$
DECLARE
  v_marker_id     UUID;
  v_organiser_id  UUID;
  v_other_player  UUID;
BEGIN
  SELECT marker_player_id INTO v_marker_id
    FROM public.round_markers WHERE round_id = p_round_id AND player_id = p_player_id;

  IF v_marker_id IS NOT NULL THEN
    RETURN QUERY SELECT v_marker_id, 'marker'::TEXT;
    RETURN;
  END IF;

  SELECT profile_id INTO v_organiser_id
    FROM public.trip_members WHERE trip_id = p_trip_id AND role = 'organiser' LIMIT 1;

  IF v_organiser_id IS NOT NULL AND v_organiser_id <> p_player_id THEN
    RETURN QUERY SELECT v_organiser_id, 'organiser_fallback'::TEXT;
    RETURN;
  END IF;

  SELECT sc.player_id INTO v_other_player
    FROM public.scorecards sc
    WHERE sc.round_id = p_round_id AND sc.player_id <> p_player_id AND sc.status <> 'withdrawn'
    ORDER BY sc.player_id LIMIT 1;

  IF v_other_player IS NOT NULL THEN
    RETURN QUERY SELECT v_other_player, 'organiser_fallback'::TEXT; -- still "no marker" fallback, just resolved to a co-player rather than the claimant themselves
    RETURN;
  END IF;

  RETURN QUERY SELECT p_player_id, 'self_verified_fallback'::TEXT; -- genuinely nobody else — rare, explicitly flagged, never silent
END;
$$;

-- ── 3. Submission RPCs — rewritten to create PENDING claims only ────────────
-- Never writes to side_comp_lead_changes. Returns would_lead_if_verified
-- (a distinct concept from becameOfficialLeader, per explicit
-- instruction) — computed against currently VERIFIED entries from other
-- players only, so a pending claim is never compared against another
-- player's own still-pending claim.

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
    WHERE side_comp_id = p_side_comp_id AND verification_status = 'verified'
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

  -- claimed_value has no numeric meaning for Longest Drive (ordinal
  -- claim, not a measured distance) — NULL here always, matching the
  -- pre-verification design's use of NULL result_value for this comp
  -- type. The claim itself is p_qualified + p_claims_beat_lead, and that
  -- assertion is stored (claimed_beat_leader) specifically so
  -- verify_longest_drive_entry can use it later — it isn't just a
  -- transient input to this one call.
  INSERT INTO public.side_comp_entries
    (side_comp_id, player_id, qualified, result_value, claimed_value, claimed_beat_leader, entered_by,
     verification_status, required_verifier_id, verifier_source)
  VALUES
    (p_side_comp_id, p_player_id, p_qualified, NULL, NULL, p_claims_beat_lead, p_entered_by,
     'pending', v_verifier_id, v_verifier_src)
  ON CONFLICT (side_comp_id, player_id) DO UPDATE SET
    qualified = EXCLUDED.qualified,
    claimed_beat_leader = EXCLUDED.claimed_beat_leader,
    updated_at = now(),
    result_value = CASE WHEN side_comp_entries.verification_status = 'pending' THEN side_comp_entries.result_value ELSE NULL END,
    verification_status = 'pending',
    required_verifier_id = CASE WHEN side_comp_entries.verification_status = 'pending' THEN side_comp_entries.required_verifier_id ELSE EXCLUDED.required_verifier_id END,
    verifier_source = CASE WHEN side_comp_entries.verification_status = 'pending' THEN side_comp_entries.verifier_source ELSE EXCLUDED.verifier_source END,
    verified_by = CASE WHEN side_comp_entries.verification_status = 'pending' THEN side_comp_entries.verified_by ELSE NULL END,
    verified_at = CASE WHEN side_comp_entries.verification_status = 'pending' THEN side_comp_entries.verified_at ELSE NULL END
  RETURNING id, side_comp_entries.required_verifier_id, side_comp_entries.verifier_source
    INTO v_entry_id, v_verifier_id, v_verifier_src;

  -- would_lead_if_verified for Longest Drive: no standing VERIFIED leader
  -- yet -> a qualifying claim would lead. A standing verified leader
  -- exists -> only if this player explicitly claims to have beaten them.
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

  RETURN QUERY SELECT v_entry_id, 'pending'::TEXT, v_would_lead,
    v_verifier_id, v_verifier_src,
    v_leader_row.player_id, v_leader_row.full_name;
END;
$$;

-- ── 4. Verification RPCs — the only place official leadership is decided ────
-- Mirrors the submission RPCs' own row-locking/leadership-comparison
-- pattern exactly, but keyed by entry_id (the claim being resolved)
-- rather than a fresh submission, and this is what writes to
-- side_comp_lead_changes — never the submission RPCs above.

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
    WHERE side_comp_id = v_side_comp_id AND verification_status = 'verified' AND result_value IS NOT NULL
    ORDER BY result_value ASC LIMIT 1;

  UPDATE public.side_comp_entries SET
    verification_status = 'verified', result_value = v_final_value,
    verified_by = p_verifier_id, verified_at = now()
    WHERE id = p_entry_id;

  SELECT player_id INTO v_new_leader_id
    FROM public.side_comp_entries
    WHERE side_comp_id = v_side_comp_id AND verification_status = 'verified' AND result_value IS NOT NULL
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

CREATE OR REPLACE FUNCTION public.verify_longest_drive_entry(
  p_entry_id    UUID,
  p_verifier_id UUID,
  p_decision    TEXT  -- 'confirm' | 'reject' — no numeric correction for an ordinal claim
) RETURNS TABLE (
  entry_id UUID, verification_status TEXT, became_official_leader BOOLEAN,
  current_leader_player_id UUID, current_leader_name TEXT, lead_change_id UUID
) LANGUAGE plpgsql AS $$
DECLARE
  v_side_comp_id     UUID;
  v_player_id        UUID;
  v_qualified        BOOLEAN;
  v_claimed_beat_ldr BOOLEAN;
  v_moment_id        UUID;
  v_required_id      UUID;
  v_is_organiser     BOOLEAN;
  v_trip_id          UUID;
  v_became_leader    BOOLEAN := false;
  v_lead_change_id   UUID;
  v_next_seq         INTEGER;
  v_prior_leader     RECORD;
  v_leader_row       RECORD;
BEGIN
  IF p_decision NOT IN ('confirm', 'reject') THEN
    RAISE EXCEPTION 'Invalid verification decision.';
  END IF;

  SELECT sce.side_comp_id, sce.player_id, sce.qualified, sce.claimed_beat_leader, sce.required_verifier_id, sce.moment_id
    INTO v_side_comp_id, v_player_id, v_qualified, v_claimed_beat_ldr, v_required_id, v_moment_id
    FROM public.side_comp_entries sce WHERE sce.id = p_entry_id FOR UPDATE;
  IF v_side_comp_id IS NULL THEN
    RAISE EXCEPTION 'Side competition entry not found.';
  END IF;

  SELECT trip_id INTO v_trip_id FROM public.side_comps WHERE id = v_side_comp_id;
  SELECT public.is_trip_organiser(v_trip_id) INTO v_is_organiser;
  IF p_verifier_id <> v_required_id AND NOT v_is_organiser THEN
    RAISE EXCEPTION 'Only the assigned verifier or a trip organiser may verify this claim.';
  END IF;

  IF p_decision = 'reject' OR NOT v_qualified THEN
    UPDATE public.side_comp_entries SET
      verification_status = 'rejected', verified_by = p_verifier_id, verified_at = now()
      WHERE id = p_entry_id;
    RETURN QUERY SELECT p_entry_id, 'rejected'::TEXT, false, NULL::UUID, NULL::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- Standing verified leader, checked fresh at verification time (not a
  -- stale snapshot from submission time) — deliberate: if another
  -- player's claim was verified in between this claim's submission and
  -- now, this decision should reflect the CURRENT state of the
  -- competition, not a moment that's already passed.
  SELECT lc.player_id INTO v_prior_leader
    FROM public.side_comp_lead_changes lc
    JOIN public.side_comp_entries sce ON sce.side_comp_id = lc.side_comp_id AND sce.player_id = lc.player_id
    WHERE lc.side_comp_id = v_side_comp_id AND sce.verification_status = 'verified' AND sce.qualified = true
    ORDER BY lc.sequence_number DESC LIMIT 1;

  UPDATE public.side_comp_entries SET
    verification_status = 'verified', verified_by = p_verifier_id, verified_at = now()
    WHERE id = p_entry_id;

  -- Becomes official leader only if there was no standing verified
  -- leader at all, or this player's own submission-time assertion
  -- (claimed_beat_leader — now actually read, not assumed) said they
  -- beat whoever was leading. A player who never claimed to beat the
  -- leader (submitted a genuine drive that just wasn't their best)
  -- correctly does NOT become leader just because their claim happens
  -- to get verified.
  IF v_prior_leader.player_id IS NULL THEN
    v_became_leader := true;
  ELSIF v_prior_leader.player_id = v_player_id THEN
    v_became_leader := false; -- already the standing leader; re-verifying isn't a hand-off
  ELSIF v_claimed_beat_ldr IS TRUE THEN
    v_became_leader := true;
  END IF;

  IF v_became_leader THEN
    SELECT COALESCE(MAX(sequence_number), 0) + 1 INTO v_next_seq
      FROM public.side_comp_lead_changes WHERE side_comp_id = v_side_comp_id;
    INSERT INTO public.side_comp_lead_changes (side_comp_id, player_id, result_value, sequence_number, moment_id)
    VALUES (v_side_comp_id, v_player_id, 0, v_next_seq, v_moment_id)
    RETURNING id INTO v_lead_change_id;
  END IF;

  SELECT full_name INTO v_leader_row FROM public.profiles WHERE id = v_player_id;

  RETURN QUERY SELECT p_entry_id, 'verified'::TEXT, v_became_leader,
    v_player_id, v_leader_row.full_name, v_lead_change_id;
END;
$$;
