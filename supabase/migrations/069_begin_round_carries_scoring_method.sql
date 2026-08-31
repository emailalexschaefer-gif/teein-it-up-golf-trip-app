-- =============================================================================
-- 069_begin_round_carries_scoring_method.sql
-- =============================================================================
-- Multi-group shared-device field-test bundle (31 Aug) — P0 systemic fix.
--
-- ROOT CAUSE, traced through the full participant/session/authority
-- chain per the explicit instruction, not patched at the screenshot
-- level:
--
-- detectSharedDeviceGroup (pure function), resolveSharedDeviceGroupForPlayer
-- and page.tsx's own inline detection (both correctly use LIVE
-- trip_members.group_id, not the broken per-round snapshot column),
-- the organiser-only /scoring-method PATCH route, and BeginRoundModal's
-- own toggle UI (correctly iterates every group, not just one) were all
-- individually confirmed correct by direct inspection. The one genuine
-- structural weakness found: scoring_method='paper' has exactly ONE
-- path into existence today — an organiser manually toggling a player
-- in BeginRoundModal BEFORE the round starts, which upserts a minimal
-- scorecards row ahead of begin_round(). begin_round() itself
-- (migration 064) was written to "never reference scoring_method" so
-- that an already-existing value survives its own UPSERT untouched —
-- correct in principle, but entirely IMPLICIT: nothing anywhere
-- confirms what value (if any) actually exists before the round
-- starts, and start/route.ts's own scorecardData construction never
-- reads or carries scoring_method at all. If that one manual toggle
-- was ever missed, mistimed, or silently reverted (its own client-side
-- try/catch already reverts the UI on any network failure), a paper
-- player's scorecard is created with the column's bare DEFAULT of
-- 'digital' — fully explaining "TEST still appears on the leaderboard
-- and in group setup (both read from trip_members/scorecards
-- generally) but disappeared from live scoring specifically"
-- (detectSharedDeviceGroup correctly requires exactly 1 digital + 1
-- paper; two 'digital' rows in a 2-player group is indistinguishable
-- from two ordinary digital players, so the shared-device UI never
-- renders for that pair).
--
-- FIX — makes the whole chain explicit and defensive instead of
-- implicit, per the brief's own "source of truth must be persisted
-- event data, not client-side state" principle:
--   1. begin_round() now explicitly WRITES scoring_method on both
--      INSERT and UPDATE, using whatever value p_scorecard_data
--      supplies for that player, falling back to the column's own
--      DEFAULT ('digital') only when genuinely absent — never
--      silently relying on "just don't touch it" behaviour again.
--   2. start/route.ts (companion change, same delivery) now explicitly
--      RE-READS each assigned player's current scoring_method from any
--      already-existing scorecards row before building
--      p_scorecard_data, and passes it through explicitly — so the
--      value is carried end-to-end even if the one prior client-side
--      toggle is ever missed, mistimed, or reverted; the round can no
--      longer silently start a paper player as digital.
--
-- Re-declared here starting from 064's own exact, confirmed-current
-- body (viewed directly before writing this, not reconstructed from
-- memory or from grep excerpts — 064's own header comment explicitly
-- warns this is exactly the mistake to avoid). Every invariant check,
-- the EXCEPTION handler, the GRANT, and the return shape are otherwise
-- byte-identical to 064; only the scorecards INSERT/ON CONFLICT clause
-- changes, plus the new v_scoring_method local variable it needs.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.begin_round(
  p_round_id         UUID,
  p_hole_data        JSONB,    -- array of {hole_number, par, stroke_index, distance?, pro_tip?}
  p_scorecard_data   JSONB     -- array of {player_id, playing_handicap, scoring_method?}
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

  -- ── 2. Upsert scorecards — scoring_method now EXPLICIT, not implicit. ──────
  -- This is the one substantive change from 064: that migration
  -- deliberately never referenced scoring_method at all (relying on
  -- Postgres's own "omitted column keeps its existing value on
  -- UPDATE... takes its DEFAULT on INSERT" behaviour). This version
  -- makes the same intent explicit and defensive instead — the value
  -- actually written is always known and traceable from the RPC
  -- arguments themselves, not inferred from what the column happened
  -- to already contain.
  FOR v_card IN SELECT * FROM jsonb_array_elements(p_scorecard_data)
  LOOP
    v_scoring_method := COALESCE(v_card->>'scoring_method', 'digital');
    IF v_scoring_method NOT IN ('digital', 'paper') THEN
      v_scoring_method := 'digital';
    END IF;

    INSERT INTO public.scorecards (round_id, player_id, playing_handicap, status, scoring_method)
    VALUES (
      p_round_id,
      (v_card->>'player_id')::UUID,
      (v_card->>'playing_handicap')::INTEGER,
      'active',
      v_scoring_method
    )
    ON CONFLICT (round_id, player_id)
    DO UPDATE SET
      playing_handicap = EXCLUDED.playing_handicap,
      status           = 'active',
      scoring_method   = EXCLUDED.scoring_method;

    v_scorecards_count := v_scorecards_count + 1;
  END LOOP;

  -- ── 3. Verify the invariants — RAISE (→ full rollback) if anything is off ──
  -- Unchanged from 064.

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
