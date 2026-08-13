-- =============================================================================
-- 042_begin_round_hole_distance.sql
-- =============================================================================
-- Course Library v1 — begin_round() (migrations 016, 020) only ever
-- extracted {hole_number, par, stroke_index} from p_hole_data, so a
-- library-sourced round's distance values were being silently dropped on
-- the primary (RPC) path, even though BeginRoundModal/start/route.ts
-- were already sending them and the direct-insert fallback path already
-- handled them correctly. Found and fixed before this shipped, not
-- after. CREATE OR REPLACE, same function, same signature (JSONB shape
-- is not part of the function's type signature, so no GRANT/drop
-- needed) — every other line of 020's logic (the invariant checks, the
-- transaction/rollback behaviour, the return shape) is unchanged.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.begin_round(
  p_round_id         UUID,
  p_hole_data        JSONB,    -- array of {hole_number, par, stroke_index, distance?}
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
  v_card                JSONB;
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
    INSERT INTO public.holes (round_id, hole_number, par, stroke_index, distance)
    VALUES (
      p_round_id,
      (v_hole->>'hole_number')::INTEGER,
      (v_hole->>'par')::INTEGER,
      (v_hole->>'stroke_index')::INTEGER,
      -- distance is optional in the payload (manually-configured/legacy
      -- rounds never send it) — NULLIF/->> already yields SQL NULL for a
      -- missing or JSON-null key, so this is a plain cast, not a
      -- COALESCE to some invented default.
      (v_hole->>'distance')::INTEGER
    )
    ON CONFLICT (round_id, hole_number)
    DO UPDATE SET
      par          = EXCLUDED.par,
      stroke_index = EXCLUDED.stroke_index,
      distance     = EXCLUDED.distance;

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

  SELECT COUNT(DISTINCT hole_number) INTO v_distinct_holes
  FROM public.holes WHERE round_id = p_round_id;

  IF v_distinct_holes != v_expected_holes THEN
    RAISE EXCEPTION 'HOLE_COUNT_MISMATCH: expected % distinct holes, found %', v_expected_holes, v_distinct_holes;
  END IF;

  IF (SELECT COUNT(*) FROM public.scorecards WHERE round_id = p_round_id AND status = 'active') != v_expected_scorecards THEN
    RAISE EXCEPTION 'SCORECARD_COUNT_MISMATCH: expected % active scorecards, found %',
      v_expected_scorecards, (SELECT COUNT(*) FROM public.scorecards WHERE round_id = p_round_id AND status = 'active');
  END IF;

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
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.begin_round(UUID, JSONB, JSONB)
  TO service_role;
