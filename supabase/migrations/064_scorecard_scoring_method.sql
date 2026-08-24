-- =============================================================================
-- 064_scorecard_scoring_method.sql
-- =============================================================================
-- Offline / Paper Scorecard Player Support — round-specific scoring method.
--
-- Inspected first, per the explicit instruction. scorecards (round_id,
-- player_id, UNIQUE(round_id, player_id)) is already the correct
-- round-specific, per-player structure — a golfer already gets a fresh
-- scorecards row every round. scoring_method belongs here, not on
-- profiles (would make it permanent/global, contradicting "a golfer
-- may use Paper Scorecard in Round 1 and Digital Scoring in Round 2")
-- and not as a second, new membership table (would duplicate the
-- round_id+player_id structure scorecards already is).
--
-- Default 'digital' — every existing scorecards row, and every new one
-- created without an explicit choice, behaves identically to before
-- this feature.
--
-- begin_round() is re-declared here starting from its TRUE current
-- definition (057_begin_round_pro_tip.sql — confirmed as the latest by
-- searching every migration that redefines this function; an earlier
-- draft of this migration was built from an outdated 035-era version
-- and would have silently regressed distance/pro_tip handling and
-- every invariant check below — caught before being applied). The
-- scorecards INSERT/ON CONFLICT clause below is otherwise IDENTICAL to
-- 057 — scoring_method is deliberately absent from both the column
-- list and the DO UPDATE SET, which is the entire mechanism: a
-- genuinely new row gets the column's own DEFAULT 'digital' (since an
-- omitted column always takes its default on INSERT), and an existing
-- row's scoring_method is never touched by this function at all, so a
-- value already chosen earlier during Finalise Round / group formation
-- survives this upsert automatically — no special-case logic was
-- needed beyond simply not referencing the column here. Every
-- invariant check, the transaction/rollback behaviour, and the return
-- shape are otherwise unchanged from 057.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

ALTER TABLE public.scorecards
  ADD COLUMN IF NOT EXISTS scoring_method TEXT NOT NULL DEFAULT 'digital'
    CHECK (scoring_method IN ('digital', 'paper'));

CREATE INDEX IF NOT EXISTS scorecards_scoring_method_idx ON public.scorecards(round_id, scoring_method);

COMMENT ON COLUMN public.scorecards.scoring_method IS
  'Round-specific — whether this player is digitally scoring this round, or their official score will be entered later via My HQ -> Enter Paper Scorecard. Round-specific by construction (scorecards is already unique per round_id+player_id), not a permanent player attribute.';

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

  -- ── 2. Upsert scorecards — scoring_method intentionally not referenced
  --      anywhere in this INSERT/ON CONFLICT (see this migration's own
  --      header comment for why that alone is the correct behaviour). ──────
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

NOTIFY pgrst, 'reload schema';
