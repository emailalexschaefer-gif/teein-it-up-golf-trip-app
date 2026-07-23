-- =============================================================================
-- 021: Diagnostics + Safe Repair for Existing Live Rounds
-- =============================================================================
-- Root-cause finding: the "No scorecard found for this group" bug was in the
-- READ path (the scoring page's server component), not the write path.
-- begin_round() already correctly creates a scorecard for every assigned
-- player — the page just couldn't see them, because of an invalid Supabase
-- embed (`scorecards.select('trip_members!inner(group_id)')`, which cannot
-- work since scorecards has no foreign key to trip_members) whose error was
-- never checked and got silently treated as "zero scorecards."
--
-- This means: existing live rounds (e.g. the "Round 1" already in progress
-- in the screenshots) almost certainly already have correct scorecard data
-- in the database. Deploying the page.tsx fix should be enough on its own.
--
-- Run the diagnostic query below FIRST against the actual affected round to
-- confirm that before assuming a repair is needed.
-- =============================================================================

-- ── Step 1: Diagnostic — run this against the actual affected round_id ──────
-- Replace 'YOUR_ROUND_ID' with the real round id from the affected trip.
--
-- SELECT
--   sc.id                AS scorecard_id,
--   sc.round_id,
--   sc.player_id,
--   p.full_name,
--   tm.group_id,
--   tg.name               AS group_name,
--   sc.playing_handicap,
--   sc.status,
--   sc.submitted_at
-- FROM public.scorecards sc
-- JOIN public.profiles p       ON p.id = sc.player_id
-- LEFT JOIN public.trip_members tm ON tm.profile_id = sc.player_id
--                                 AND tm.trip_id = (SELECT trip_id FROM public.rounds WHERE id = sc.round_id)
-- LEFT JOIN public.trip_groups  tg ON tg.id = tm.group_id
-- WHERE sc.round_id = 'YOUR_ROUND_ID'
-- ORDER BY tm.group_id, p.full_name;
--
-- Also check holes and round status:
-- SELECT COUNT(*) AS hole_count FROM public.holes WHERE round_id = 'YOUR_ROUND_ID';
-- SELECT id, name, status, holes FROM public.rounds WHERE id = 'YOUR_ROUND_ID';

-- ── Step 2: Safe repair function ─────────────────────────────────────────────
-- Only needed if the diagnostic above shows scorecards genuinely missing or
-- unmapped to a group for an already-active round. begin_round() itself
-- can't be reused for this — it requires status = 'upcoming' and would
-- refuse to touch an already-active round. This function repairs an active
-- round in place: idempotent (safe to run more than once), does not change
-- round status, does not touch existing score_entries, and only creates
-- scorecards that are actually missing.

CREATE OR REPLACE FUNCTION public.repair_round_scorecards(p_round_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip_id          UUID;
  v_created          INTEGER := 0;
  v_member           RECORD;
  v_still_unmapped   INTEGER;
BEGIN
  SELECT trip_id INTO v_trip_id FROM public.rounds WHERE id = p_round_id;
  IF v_trip_id IS NULL THEN
    RAISE EXCEPTION 'ROUND_NOT_FOUND: no round with id %', p_round_id;
  END IF;

  -- Create a scorecard for any assigned trip member who is missing one.
  -- Uses the member's own playing_handicap if set, else their profile
  -- handicap, else 0 — same fallback order as resolvePlayingHandicap().
  FOR v_member IN
    SELECT tm.profile_id, tm.playing_handicap, p.handicap AS profile_handicap
    FROM public.trip_members tm
    JOIN public.profiles p ON p.id = tm.profile_id
    WHERE tm.trip_id = v_trip_id
      AND tm.group_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.scorecards sc
        WHERE sc.round_id = p_round_id AND sc.player_id = tm.profile_id
      )
  LOOP
    INSERT INTO public.scorecards (round_id, player_id, playing_handicap, status)
    VALUES (
      p_round_id,
      v_member.profile_id,
      ROUND(COALESCE(v_member.playing_handicap, v_member.profile_handicap, 0)),
      'active'
    );
    v_created := v_created + 1;
  END LOOP;

  -- Report (does not repair) players still missing a playing-group
  -- assignment — that's a decision for the organiser, not this function.
  SELECT COUNT(*) INTO v_still_unmapped
  FROM public.trip_members
  WHERE trip_id = v_trip_id AND group_id IS NULL;

  RETURN jsonb_build_object(
    'roundId', p_round_id,
    'scorecardsCreated', v_created,
    'playersStillUnassignedToGroup', v_still_unmapped
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.repair_round_scorecards(UUID) TO service_role;

-- ── Usage ─────────────────────────────────────────────────────────────────
-- Run once against the specific affected round, via Supabase SQL Editor:
--   SELECT public.repair_round_scorecards('YOUR_ROUND_ID');
-- Safe to run again — it only ever creates scorecards that are genuinely
-- missing; it never duplicates or overwrites an existing one.
