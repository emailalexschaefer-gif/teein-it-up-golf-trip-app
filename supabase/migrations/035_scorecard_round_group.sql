-- =============================================================================
-- 035_scorecard_round_group.sql
-- =============================================================================
-- Adds scorecards.group_id — a per-round snapshot of which playing group
-- a player was in for THAT round, mirroring the exact pattern already
-- established by scorecards.playing_handicap (migration 004 + the
-- begin_round() RPC, migrations 016/020).
--
-- THE ARCHITECTURAL GAP THIS CLOSES:
-- trip_members.group_id is a single, mutable, trip-level fact — there is
-- currently no historical record of which group a player was in for a
-- completed round. playing_handicap already avoids this exact problem
-- (begin_round() snapshots trip_members.playing_handicap into
-- scorecards.playing_handicap at the moment a round starts, so a later
-- trip_members.playing_handicap change can never retroactively alter an
-- already-started round's scoring). group_id had no equivalent snapshot.
-- Reseeding groups for Round 2 (Leaders Last, or any manual reshuffle)
-- would silently have rewritten Round 1's only record of its own
-- groupings, since there was nowhere else that fact lived.
--
-- Nullable and additive — existing scorecards (from before this
-- migration) simply have group_id = NULL, which read code should treat
-- the same as "unknown," not as an error.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

ALTER TABLE public.scorecards
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.trip_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS scorecards_group_id_idx ON public.scorecards(group_id) WHERE group_id IS NOT NULL;

-- begin_round() must accept and store group_id the same way it already
-- does playing_handicap — one more field read per scorecard. This is
-- the COMPLETE, verbatim original function body from migration 020
-- (every validation check, the exact return shape, the exception
-- handler, the GRANT) — the only change is group_id added to the
-- scorecards INSERT/UPDATE. Recreated in full because a plpgsql
-- function body can't be partially patched; copied from the actual
-- source rather than reconstructed from memory, specifically to avoid
-- silently dropping any of the existing validation.
CREATE OR REPLACE FUNCTION public.begin_round(
  p_round_id         UUID,
  p_hole_data        JSONB,    -- array of {hole_number, par, stroke_index}
  p_scorecard_data   JSONB     -- array of {player_id, playing_handicap, group_id}
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

  -- ── 2. Upsert scorecards — now also snapshots group_id ─────────────────────
  FOR v_card IN SELECT * FROM jsonb_array_elements(p_scorecard_data)
  LOOP
    INSERT INTO public.scorecards (round_id, player_id, playing_handicap, group_id, status)
    VALUES (
      p_round_id,
      (v_card->>'player_id')::UUID,
      (v_card->>'playing_handicap')::INTEGER,
      NULLIF(v_card->>'group_id', '')::UUID,
      'active'
    )
    ON CONFLICT (round_id, player_id)
    DO UPDATE SET
      playing_handicap = EXCLUDED.playing_handicap,
      group_id         = EXCLUDED.group_id,
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
  -- Still validated against the live trip_members.group_id here (this is a
  -- "can this round even start" gate, correctly checking current state) —
  -- separate from scorecards.group_id above, which is the new historical
  -- snapshot for later reference. Both are correct for their own purpose.
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

NOTIFY pgrst, 'reload schema';
