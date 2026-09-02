-- =============================================================================
-- 070_begin_round_writes_group_id.sql
-- =============================================================================
-- Live Scoring Stabilisation brief (1 Sep) — P1 item 4, "Group Makers &
-- Breakers missing," root cause.
--
-- scorecards.group_id was NEVER actually written by begin_round() — not
-- in 057, not in 064, not in 069 (all three redeclared this function
-- and none of them included group_id in the scorecards INSERT column
-- list, confirmed by reading 069's own body directly before writing
-- this migration). Every scorecard's group_id has been silently NULL
-- since that column's introduction, on every round, in every trip —
-- despite start/route.ts already correctly building its
-- p_scorecard_data with a group_id field for every player the entire
-- time. The RPC simply never used it.
--
-- Why this specifically broke Group Makers & Breakers: makersBreakers.ts's
-- own PlayerRoundData interface documents scorecards.group_id as a
-- deliberate, round-specific snapshot ("set once at begin_round() and
-- never mutated afterward... the SAME snapshot mechanism multiRound.ts
-- already relies on for group identity elsewhere in this app") — a
-- real, existing architectural decision, not something to route around
-- by switching to live trip_members.group_id in individual consumers.
-- bucketByGroup() requires every player to have a truthy groupId to be
-- included in any group calculation at all; with the column always
-- NULL, every group-scope Makers & Breakers finder always received
-- zero eligible groups, while every individual-scope finder (which
-- needs no group data) worked correctly the entire time — matching
-- the confirmed real-device symptom exactly.
--
-- This also explains a second, related symptom this same fix closes:
-- the highlights route's per-group SHOTGUN starting-hole lookup
-- (round_group_starting_holes, keyed by group_id) was silently falling
-- through to the round-level default for every group, for the
-- identical reason.
--
-- FIX: begin_round() now writes group_id on both INSERT and UPDATE,
-- from p_scorecard_data — the field was already being sent, it just
-- needs the RPC to actually persist it. No change needed to
-- start/route.ts; its scorecardData construction already includes
-- group_id (confirmed by reading it directly).
--
-- Explicitly does NOT change scorecards.group_id's snapshot semantics:
-- once written at begin_round() time, it is still never mutated
-- afterward by this or any other function — a player moved to a
-- different playing group after a round has already started keeps
-- their original round's group_id for that round's own history,
-- exactly as the existing interface comment already documents as
-- intended.
--
-- Re-declared here from 069's own exact, directly-viewed-before-writing
-- body (not reconstructed from memory or grep excerpts). Every
-- invariant check, the EXCEPTION handler, the GRANT, and the return
-- shape are byte-identical to 069; only the scorecards INSERT/ON
-- CONFLICT clause changes to add group_id.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.begin_round(
  p_round_id         UUID,
  p_hole_data        JSONB,    -- array of {hole_number, par, stroke_index, distance?, pro_tip?}
  p_scorecard_data   JSONB     -- array of {player_id, playing_handicap, scoring_method?, group_id?}
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
  v_scoring_method      TEXT;
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

  -- ── 2. Upsert scorecards — group_id now written, per this migration's ──────
  --      own header. scoring_method handling unchanged from 069.
  FOR v_card IN SELECT * FROM jsonb_array_elements(p_scorecard_data)
  LOOP
    v_scoring_method := COALESCE(v_card->>'scoring_method', 'digital');
    IF v_scoring_method NOT IN ('digital', 'paper') THEN
      v_scoring_method := 'digital';
    END IF;

    INSERT INTO public.scorecards (round_id, player_id, playing_handicap, status, scoring_method, group_id)
    VALUES (
      p_round_id,
      (v_card->>'player_id')::UUID,
      (v_card->>'playing_handicap')::INTEGER,
      'active',
      v_scoring_method,
      (v_card->>'group_id')::UUID
    )
    ON CONFLICT (round_id, player_id)
    DO UPDATE SET
      playing_handicap = EXCLUDED.playing_handicap,
      status           = 'active',
      scoring_method   = EXCLUDED.scoring_method,
      group_id         = EXCLUDED.group_id;

    v_scorecards_count := v_scorecards_count + 1;
  END LOOP;

  -- ── 3. Verify the invariants — RAISE (→ full rollback) if anything is off ──
  -- Unchanged from 069.

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
