-- =============================================================================
-- 020: Begin Round Transaction Integrity
-- =============================================================================
-- begin_round() (migration 016) was already atomic in the sense that any SQL
-- error inside the function rolls back everything in that call — a single
-- plpgsql function body is one implicit transaction. What it did NOT do is
-- verify the business-level invariants after the inserts: that the right
-- NUMBER of holes/scorecards actually landed, and that every scorecard can
-- actually be mapped to a playing group. A silent partial success (e.g. a
-- caller passing an incomplete scorecard array) would previously still
-- report success.
--
-- This migration adds explicit post-insert verification and a structured
-- result, and RAISEs (→ full rollback, round stays 'upcoming') if anything
-- doesn't match expectations.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.begin_round(
  p_round_id         UUID,
  p_hole_data        JSONB,    -- array of {hole_number, par, stroke_index}
  p_scorecard_data   JSONB     -- array of {player_id, playing_handicap}
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip_id            UUID;
  v_holes_count        INTEGER := 0;
  v_scorecards_count   INTEGER := 0;
  v_expected_holes     INTEGER;
  v_expected_scorecards INTEGER;
  v_distinct_holes     INTEGER;
  v_groups_processed   INTEGER;
  v_unmapped_players   INTEGER;
  v_hole               JSONB;
  v_card               JSONB;
BEGIN
  v_expected_holes      := jsonb_array_length(p_hole_data);
  v_expected_scorecards := jsonb_array_length(p_scorecard_data);

  -- Verify round is still upcoming (guard against race conditions)
  SELECT trip_id INTO v_trip_id
  FROM public.rounds WHERE id = p_round_id AND status = 'upcoming';

  IF v_trip_id IS NULL THEN
    RAISE EXCEPTION 'ROUND_NOT_UPCOMING: This round cannot be started (it may have already begun).';
  END IF;

  -- ── 1. Upsert holes ────────────────────────────────────────────────────────
  FOR v_hole IN SELECT * FROM jsonb_array_elements(p_hole_data)
  LOOP
    INSERT INTO public.holes (round_id, hole_number, par, stroke_index)
    VALUES (
      p_round_id,
      (v_hole->>'hole_number')::INTEGER,
      (v_hole->>'par')::INTEGER,
      (v_hole->>'stroke_index')::INTEGER
    )
    ON CONFLICT (round_id, hole_number)
    DO UPDATE SET
      par          = EXCLUDED.par,
      stroke_index = EXCLUDED.stroke_index;

    v_holes_count := v_holes_count + 1;
  END LOOP;

  -- ── 2. Upsert scorecards ───────────────────────────────────────────────────
  FOR v_card IN SELECT * FROM jsonb_array_elements(p_scorecard_data)
  LOOP
    INSERT INTO public.scorecards (round_id, player_id, playing_handicap, status)
    VALUES (
      p_round_id,
      (v_card->>'player_id')::UUID,
      (v_card->>'playing_handicap')::INTEGER,
      'active'
    )
    ON CONFLICT (round_id, player_id)
    DO UPDATE SET
      playing_handicap = EXCLUDED.playing_handicap,
      status           = 'active';

    v_scorecards_count := v_scorecards_count + 1;
  END LOOP;

  -- ── 3. Verify the invariants — RAISE (→ full rollback) if anything is off ──

  -- Distinct hole_number count actually present for this round must equal
  -- what was expected — catches duplicate/malformed hole_number input that
  -- would otherwise upsert fewer distinct holes than the loop count implies.
  SELECT COUNT(DISTINCT hole_number) INTO v_distinct_holes
  FROM public.holes WHERE round_id = p_round_id;

  IF v_distinct_holes != v_expected_holes THEN
    RAISE EXCEPTION 'HOLE_COUNT_MISMATCH: expected % distinct holes, found %', v_expected_holes, v_distinct_holes;
  END IF;

  -- Every scorecard we just wrote must actually exist, belong to this round,
  -- and every participating player must have exactly one (UNIQUE constraint
  -- already guarantees "exactly one"; this confirms the COUNT matches input).
  IF (SELECT COUNT(*) FROM public.scorecards WHERE round_id = p_round_id AND status = 'active') != v_expected_scorecards THEN
    RAISE EXCEPTION 'SCORECARD_COUNT_MISMATCH: expected % active scorecards, found %',
      v_expected_scorecards, (SELECT COUNT(*) FROM public.scorecards WHERE round_id = p_round_id AND status = 'active');
  END IF;

  -- Every scorecard just written must map to a playing group via
  -- trip_members.group_id — a scorecard whose player has no group assigned
  -- can never be scored as part of a group (Sprint 5B's core requirement).
  SELECT COUNT(*) INTO v_unmapped_players
  FROM public.scorecards sc
  JOIN public.trip_members tm ON tm.trip_id = v_trip_id AND tm.profile_id = sc.player_id
  WHERE sc.round_id = p_round_id AND tm.group_id IS NULL;

  IF v_unmapped_players > 0 THEN
    RAISE EXCEPTION 'UNMAPPED_PLAYING_GROUP: % scorecard(s) belong to players with no playing group assigned', v_unmapped_players;
  END IF;

  SELECT COUNT(DISTINCT tm.group_id) INTO v_groups_processed
  FROM public.scorecards sc
  JOIN public.trip_members tm ON tm.trip_id = v_trip_id AND tm.profile_id = sc.player_id
  WHERE sc.round_id = p_round_id;

  -- ── 4. Transition round status ─────────────────────────────────────────────
  -- Only reached if every check above passed.
  UPDATE public.rounds
    SET status = 'active'
    WHERE id = p_round_id;

  -- ── Return structured summary ──────────────────────────────────────────────
  RETURN jsonb_build_object(
    'roundId',            p_round_id,
    'status',             'active',
    'holesCreated',       v_holes_count,
    'scorecardsCreated',  v_scorecards_count,
    'expectedScorecards', v_expected_scorecards,
    'groupsProcessed',    v_groups_processed,
    'success',            true
  );

EXCEPTION
  WHEN OTHERS THEN
    -- The surrounding transaction automatically rolls back — the round stays
    -- 'upcoming', no partial holes/scorecards persist. Re-raise so the
    -- caller (the start-round API route) receives the specific error code
    -- in the message and can show it, rather than reporting success.
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.begin_round(UUID, JSONB, JSONB)
  TO service_role;

-- Verification:
-- SELECT proname FROM pg_proc WHERE proname = 'begin_round';
-- Should return: begin_round
