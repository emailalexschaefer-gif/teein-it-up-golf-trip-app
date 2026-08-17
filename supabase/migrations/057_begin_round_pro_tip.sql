-- =============================================================================
-- 057_begin_round_pro_tip.sql
-- =============================================================================
-- Pro Tip snapshot into the materialized round — mirrors exactly what
-- migration 042 did for distance: holes.pro_tip is added, and
-- begin_round() is extended to copy pro_tip from the payload the same
-- way it already copies par/stroke_index/distance. This is what
-- actually satisfies "historical rounds should retain the tip that
-- applied when that round was configured" — once begin_round() runs,
-- holes.pro_tip is a frozen copy for that round; a later Course
-- Library edit to course_holes.pro_tip can never reach back and change
-- an already-started round.
--
-- CREATE OR REPLACE only — same signature as 042, no GRANT/drop
-- needed. Every invariant check, the transaction/rollback behaviour,
-- and the return shape are unchanged.
-- =============================================================================

ALTER TABLE public.holes
  ADD COLUMN IF NOT EXISTS pro_tip TEXT;

CREATE OR REPLACE FUNCTION public.begin_round(
  p_round_id         UUID,
  p_hole_data        JSONB,    -- array of {hole_number, par, stroke_index, distance?, pro_tip?}
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

  SELECT trip_id INTO v_trip_id
  FROM public.rounds WHERE id = p_round_id AND status = 'upcoming';

  IF v_trip_id IS NULL THEN
    RAISE EXCEPTION 'ROUND_NOT_UPCOMING: This round cannot be started (it may have already begun).';
  END IF;

  -- ── 1. Upsert holes ────────────────────────────────────────────────────────
  FOR v_hole IN SELECT * FROM jsonb_array_elements(p_hole_data)
  LOOP
    INSERT INTO public.holes (round_id, hole_number, par, stroke_index, distance, pro_tip)
    VALUES (
      p_round_id,
      (v_hole->>'hole_number')::INTEGER,
      (v_hole->>'par')::INTEGER,
      (v_hole->>'stroke_index')::INTEGER,
      (v_hole->>'distance')::INTEGER,
      -- ->> already yields SQL NULL for a missing or JSON-null key —
      -- a manually-configured round (never sends pro_tip at all) and a
      -- library round with no tip set for that hole both correctly end
      -- up NULL here, same reasoning as distance above.
      v_hole->>'pro_tip'
    )
    ON CONFLICT (round_id, hole_number)
    DO UPDATE SET
      par          = EXCLUDED.par,
      stroke_index = EXCLUDED.stroke_index,
      distance     = EXCLUDED.distance,
      pro_tip      = EXCLUDED.pro_tip;

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
