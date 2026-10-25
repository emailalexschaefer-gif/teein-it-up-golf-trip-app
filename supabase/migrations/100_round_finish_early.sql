-- =============================================================================
-- 100_round_finish_early.sql  (Package 3: Finish Round Early)
-- =============================================================================
-- An ACTIVE round interrupted by weather/safety can be finished early WITHOUT
-- changing it to 'cancelled' and without writing a single fake score:
--
--   * rounds.status becomes 'completed' (so every existing "completed round"
--     path -- Event Memories, presentation, leaderboard -- keeps working) and
--     rounds.closed_early = true records HOW it ended.
--   * Official nine-hole results are FROZEN per player in round_official_results.
--     'qualifying'  = the first nine holes of THAT player's own playing order
--                     (group starting hole, wrapping) all have a recorded score.
--     'incomplete'  = anything less. official_points is NULL for incomplete, so
--                     an incomplete player can never be mistaken for a genuine
--                     zero (a qualifying nine worth 0 points stores 0).
--   * counts_toward_event is TRUE for every existing round. The finish-early
--     function writes whatever the organiser chose (the app defaults to FALSE).
--   * Every decision is written to round_early_finish_events.
--
-- finish_round_early(), set_round_early_inclusion() and refresh_round_official_results()
-- each run as ONE transaction: any failure rolls back everything.
--
-- Additive only. Does not alter 097 (round_status_events), 098 or 099, and
-- changes no existing data. canonical hole scores are never written.
--
-- Run order: 097 -> 098 -> 099 -> 100.
-- The app tolerates 100 being absent (reads treat every round as normal);
-- only Finish Round Early itself needs it and says so.
--
-- ROLLBACK (reinstate nothing; rounds finished early simply read as normal
-- completed rounds afterwards):
--   DROP FUNCTION IF EXISTS public.refresh_round_official_results(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.set_round_early_inclusion(uuid, uuid, boolean, boolean);
--   DROP FUNCTION IF EXISTS public.finish_round_early(uuid, uuid, text, text, boolean, integer, boolean);
--   DROP FUNCTION IF EXISTS public.round_official_snapshot(uuid, integer);
--   DROP TABLE IF EXISTS public.round_early_finish_events;
--   DROP TABLE IF EXISTS public.round_official_results;
--   ALTER TABLE public.rounds DROP CONSTRAINT IF EXISTS rounds_closed_early_consistent;
--   ALTER TABLE public.rounds
--     DROP COLUMN IF EXISTS closed_early, DROP COLUMN IF EXISTS closed_early_reason,
--     DROP COLUMN IF EXISTS closed_early_note, DROP COLUMN IF EXISTS closed_early_at,
--     DROP COLUMN IF EXISTS closed_early_by, DROP COLUMN IF EXISTS official_holes,
--     DROP COLUMN IF EXISTS counts_toward_event;
--   DROP FUNCTION IF EXISTS public.is_distinct_smallint_array(smallint[]);
--   DROP FUNCTION IF EXISTS public.sum_smallint_array(smallint[]);
--   DROP FUNCTION IF EXISTS public.official_snapshot_is_mixed(uuid, integer);
-- =============================================================================

ALTER TABLE public.rounds
  ADD COLUMN IF NOT EXISTS closed_early        BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS closed_early_reason TEXT        NULL,
  ADD COLUMN IF NOT EXISTS closed_early_note   TEXT        NULL,
  ADD COLUMN IF NOT EXISTS closed_early_at     TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS closed_early_by     UUID        NULL REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS official_holes      SMALLINT    NULL,
  ADD COLUMN IF NOT EXISTS counts_toward_event BOOLEAN     NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rounds_closed_early_consistent' AND conrelid = 'public.rounds'::regclass) THEN
    ALTER TABLE public.rounds ADD CONSTRAINT rounds_closed_early_consistent CHECK (
      CASE WHEN closed_early THEN
            status = 'completed'
        AND closed_early_reason IN ('weather','safety','other')
        AND closed_early_at IS NOT NULL AND closed_early_by IS NOT NULL
        AND (closed_early_note IS NULL OR char_length(closed_early_note) <= 200)
        AND (official_holes IS NULL OR official_holes = 9)
        AND (counts_toward_event = false OR official_holes IS NOT NULL)
      ELSE
            closed_early_reason IS NULL AND closed_early_note IS NULL
        AND closed_early_at IS NULL AND closed_early_by IS NULL
        AND official_holes IS NULL AND counts_toward_event = true
      END
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.is_distinct_smallint_array(a smallint[])
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT a IS NOT NULL AND (SELECT count(DISTINCT x) FROM unnest(a) AS x) = cardinality(a)
$$;

CREATE OR REPLACE FUNCTION public.sum_smallint_array(a smallint[])
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT COALESCE(sum(x), 0)::integer FROM unnest(a) AS x $$;

CREATE TABLE IF NOT EXISTS public.round_official_results (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  round_id         UUID        NOT NULL REFERENCES public.rounds(id)     ON DELETE CASCADE,
  player_id        UUID        NOT NULL REFERENCES public.profiles(id),
  scorecard_id     UUID        NOT NULL REFERENCES public.scorecards(id) ON DELETE CASCADE,
  result_kind      TEXT        NOT NULL CHECK (result_kind IN ('qualifying','incomplete')),
  start_hole       SMALLINT    NOT NULL CHECK (start_hole BETWEEN 1 AND 18),
  holes_played     SMALLINT    NOT NULL CHECK (holes_played >= 0),
  actual_points    INTEGER     NOT NULL CHECK (actual_points >= 0),   -- every hole actually played
  playing_handicap INTEGER     NOT NULL,                              -- snapshot, never the profile handicap
  segment_holes    SMALLINT[]  NULL,                                  -- the nine holes, in playing order
  segment_points   SMALLINT[]  NULL,                                  -- canonical points for each of those holes (countback + audit)
  official_points  INTEGER     NULL,                                  -- NULL = incomplete (never a fake zero)
  computed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  computed_by      UUID        NOT NULL REFERENCES public.profiles(id),
  CONSTRAINT round_official_results_unique UNIQUE (round_id, player_id),
  CONSTRAINT round_official_results_shape CHECK (
    (result_kind = 'qualifying'
       AND official_points IS NOT NULL AND official_points >= 0
       AND segment_holes IS NOT NULL AND cardinality(segment_holes) = 9
       AND public.is_distinct_smallint_array(segment_holes)
       AND segment_points IS NOT NULL AND cardinality(segment_points) = 9
       AND public.sum_smallint_array(segment_points) = official_points
       AND segment_holes <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]::smallint[]
       AND holes_played >= 9)
    OR
    (result_kind = 'incomplete' AND official_points IS NULL AND segment_holes IS NULL AND segment_points IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS round_official_results_round_idx ON public.round_official_results (round_id);
ALTER TABLE public.round_official_results ENABLE ROW LEVEL SECURITY;  -- server-only: no policies

CREATE TABLE IF NOT EXISTS public.round_early_finish_events (
  id            UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id       UUID        NOT NULL REFERENCES public.trips(id)  ON DELETE CASCADE,
  round_id      UUID        NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  action        TEXT        NOT NULL CHECK (action IN ('finished_early','inclusion_changed','results_refreshed')),
  actor_id      UUID        NOT NULL REFERENCES public.profiles(id),
  counts_toward_event     BOOLEAN  NULL,
  official_holes          SMALLINT NULL,
  mixed_nines_acknowledged BOOLEAN NOT NULL DEFAULT false,
  details       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS round_early_finish_events_round_idx ON public.round_early_finish_events (round_id, created_at);
ALTER TABLE public.round_early_finish_events ENABLE ROW LEVEL SECURITY;  -- server-only: no policies

-- ---------------------------------------------------------------------------
-- The ONE definition of "official nine" (preview, finish, refresh and stale checks
-- all call this; the app contains no second implementation).
--   * holes are ordered by hole_number, rotated to start at the player's own starting
--     hole (shotgun group start when the round is a shotgun round, else the round's start
--     tee) and wrapped; the FIRST p_official_holes of that sequence are the segment.
--   * a hole counts only if the player's own ('self') entry has a gross score or a
--     recorded pick-up. Nothing is ever invented for an unplayed hole.
--   * points are the canonical stored stableford_pts. Nothing is recalculated.
-- Not a "best nine", and scattered scores never qualify.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.round_official_snapshot(p_round_id uuid, p_official_holes integer)
RETURNS TABLE (
  scorecard_id uuid, player_id uuid, start_hole integer, holes_played integer, actual_points integer,
  playing_handicap integer, segment_holes smallint[], segment_points smallint[], official_points integer, result_kind text
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_round public.rounds%ROWTYPE;
  v_nums  integer[];
  v_n     integer;
  c       record;
  v_idx   integer;
  v_seg   smallint[];
  v_segpts smallint[];
  v_ok    boolean;
  v_pts   integer;
  i       integer;
  v_hole  integer;
  v_entry record;
BEGIN
  SELECT * INTO v_round FROM public.rounds WHERE id = p_round_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  IF p_official_holes IS NULL OR p_official_holes <> 9 THEN RAISE EXCEPTION 'INVALID_OFFICIAL_HOLES'; END IF;
  SELECT array_agg(h.hole_number ORDER BY h.hole_number) INTO v_nums FROM public.holes h WHERE h.round_id = p_round_id;
  v_n := COALESCE(cardinality(v_nums), 0);
  IF v_n < p_official_holes THEN RAISE EXCEPTION 'ROUND_TOO_SHORT_FOR_OFFICIAL_HOLES'; END IF;

  FOR c IN
    SELECT sc.id AS sid, sc.player_id AS pid, sc.playing_handicap AS hc,
           CASE WHEN v_round.start_type = 'shotgun' AND rgs.starting_hole IS NOT NULL
                THEN rgs.starting_hole ELSE v_round.starting_hole_number END AS sh
    FROM public.scorecards sc
    LEFT JOIN public.trip_members tm
           ON tm.trip_id = v_round.trip_id AND tm.profile_id = sc.player_id
    LEFT JOIN public.round_group_starting_holes rgs
           ON rgs.round_id = p_round_id AND rgs.group_id = COALESCE(sc.group_id, tm.group_id)
    WHERE sc.round_id = p_round_id AND sc.status <> 'withdrawn'
    ORDER BY sc.player_id
  LOOP
    v_idx := COALESCE(array_position(v_nums, c.sh), 1);
    v_seg := ARRAY[]::smallint[]; v_segpts := ARRAY[]::smallint[];
    v_ok := true; v_pts := 0;
    FOR i IN 0 .. p_official_holes - 1 LOOP
      v_hole := v_nums[((v_idx - 1 + i) % v_n) + 1];
      v_seg := v_seg || v_hole::smallint;
      SELECT se.gross_score, se.is_no_return, se.stableford_pts INTO v_entry
        FROM public.score_entries se JOIN public.holes h ON h.id = se.hole_id
       WHERE se.scorecard_id = c.sid AND se.capture_role = 'self' AND h.round_id = p_round_id AND h.hole_number = v_hole;
      IF NOT FOUND OR (v_entry.gross_score IS NULL AND NOT v_entry.is_no_return) THEN
        v_ok := false;
      ELSE
        v_pts := v_pts + COALESCE(v_entry.stableford_pts, 0);
        v_segpts := v_segpts || COALESCE(v_entry.stableford_pts, 0)::smallint;
      END IF;
    END LOOP;

    scorecard_id := c.sid; player_id := c.pid; start_hole := c.sh; playing_handicap := c.hc;
    SELECT count(*)::integer, COALESCE(sum(COALESCE(se.stableford_pts, 0)), 0)::integer
      INTO holes_played, actual_points
      FROM public.score_entries se
     WHERE se.scorecard_id = c.sid AND se.capture_role = 'self'
       AND (se.gross_score IS NOT NULL OR se.is_no_return);
    IF v_ok THEN
      segment_holes := v_seg; segment_points := v_segpts; official_points := v_pts; result_kind := 'qualifying';
    ELSE
      segment_holes := NULL; segment_points := NULL; official_points := NULL; result_kind := 'incomplete';
    END IF;
    RETURN NEXT;
  END LOOP;
END $$;

-- Different groups whose official nines are different sets of holes?
CREATE OR REPLACE FUNCTION public.official_snapshot_is_mixed(p_round_id uuid, p_official_holes integer)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT count(DISTINCT (SELECT array_agg(x ORDER BY x) FROM unnest(s.segment_holes) AS x)) > 1
    FROM public.round_official_snapshot(p_round_id, p_official_holes) s
   WHERE s.result_kind = 'qualifying'
$$;

CREATE OR REPLACE FUNCTION public.finish_round_early(
  p_round_id uuid, p_actor uuid, p_reason text, p_note text,
  p_counts boolean, p_official_holes integer, p_ack_mixed boolean
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_round public.rounds%ROWTYPE;
  v_note  text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_q integer := 0; v_i integer := 0; v_mixed boolean := false;
BEGIN
  SELECT * INTO v_round FROM public.rounds WHERE id = p_round_id FOR UPDATE;   -- serialises repeat requests
  IF NOT FOUND THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  IF v_round.status <> 'active' THEN RAISE EXCEPTION 'ROUND_NOT_ACTIVE'; END IF;
  IF p_reason NOT IN ('weather','safety','other') THEN RAISE EXCEPTION 'INVALID_REASON'; END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 200 THEN RAISE EXCEPTION 'NOTE_TOO_LONG'; END IF;
  IF p_official_holes IS NOT NULL AND p_official_holes <> 9 THEN RAISE EXCEPTION 'INVALID_OFFICIAL_HOLES'; END IF;
  IF COALESCE(p_counts, false) AND p_official_holes IS NULL THEN RAISE EXCEPTION 'INCLUSION_NEEDS_OFFICIAL_RESULT'; END IF;

  IF p_official_holes IS NOT NULL THEN
    INSERT INTO public.round_official_results
      (round_id, player_id, scorecard_id, result_kind, start_hole, holes_played, actual_points,
       playing_handicap, segment_holes, segment_points, official_points, computed_by)
    SELECT p_round_id, s.player_id, s.scorecard_id, s.result_kind, s.start_hole, s.holes_played, s.actual_points,
           s.playing_handicap, s.segment_holes, s.segment_points, s.official_points, p_actor
      FROM public.round_official_snapshot(p_round_id, p_official_holes) s;
    SELECT count(*) FILTER (WHERE result_kind = 'qualifying'), count(*) FILTER (WHERE result_kind = 'incomplete')
      INTO v_q, v_i FROM public.round_official_results WHERE round_id = p_round_id;
    v_mixed := COALESCE(public.official_snapshot_is_mixed(p_round_id, p_official_holes), false);
    IF COALESCE(p_counts, false) THEN
      IF v_q = 0 THEN RAISE EXCEPTION 'NO_QUALIFYING_PLAYERS'; END IF;
      IF v_mixed AND NOT COALESCE(p_ack_mixed, false) THEN RAISE EXCEPTION 'MIXED_NINES_ACK_REQUIRED'; END IF;
    END IF;
  END IF;

  UPDATE public.rounds SET
    status = 'completed', closed_early = true, closed_early_reason = p_reason, closed_early_note = v_note,
    closed_early_at = now(), closed_early_by = p_actor, official_holes = p_official_holes,
    counts_toward_event = COALESCE(p_counts, false)
  WHERE id = p_round_id;

  INSERT INTO public.round_early_finish_events
    (trip_id, round_id, action, actor_id, counts_toward_event, official_holes, mixed_nines_acknowledged, details)
  VALUES (v_round.trip_id, p_round_id, 'finished_early', p_actor, COALESCE(p_counts, false), p_official_holes,
          COALESCE(p_ack_mixed, false) AND v_mixed,
          jsonb_build_object('reason', p_reason, 'note', v_note, 'qualifying', v_q, 'incomplete', v_i, 'mixed_nines', v_mixed));

  RETURN jsonb_build_object('ok', true, 'qualifying', v_q, 'incomplete', v_i, 'mixed_nines', v_mixed,
                            'counts_toward_event', COALESCE(p_counts, false), 'official_holes', p_official_holes);
END $$;

CREATE OR REPLACE FUNCTION public.set_round_early_inclusion(
  p_round_id uuid, p_actor uuid, p_counts boolean, p_ack_mixed boolean
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_round public.rounds%ROWTYPE; v_q integer; v_mixed boolean := false;
BEGIN
  SELECT * INTO v_round FROM public.rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  IF NOT v_round.closed_early THEN RAISE EXCEPTION 'ROUND_NOT_FINISHED_EARLY'; END IF;
  IF p_counts IS NULL THEN RAISE EXCEPTION 'INVALID_INCLUSION'; END IF;
  IF p_counts = v_round.counts_toward_event THEN RAISE EXCEPTION 'INCLUSION_UNCHANGED'; END IF;
  IF p_counts THEN
    IF v_round.official_holes IS NULL THEN RAISE EXCEPTION 'INCLUSION_NEEDS_OFFICIAL_RESULT'; END IF;
    SELECT count(*) INTO v_q FROM public.round_official_results WHERE round_id = p_round_id AND result_kind = 'qualifying';
    IF v_q = 0 THEN RAISE EXCEPTION 'NO_QUALIFYING_PLAYERS'; END IF;
    v_mixed := COALESCE(public.official_snapshot_is_mixed(p_round_id, v_round.official_holes), false);
    IF v_mixed AND NOT COALESCE(p_ack_mixed, false) THEN RAISE EXCEPTION 'MIXED_NINES_ACK_REQUIRED'; END IF;
  END IF;
  UPDATE public.rounds SET counts_toward_event = p_counts WHERE id = p_round_id;
  INSERT INTO public.round_early_finish_events
    (trip_id, round_id, action, actor_id, counts_toward_event, official_holes, mixed_nines_acknowledged, details)
  VALUES (v_round.trip_id, p_round_id, 'inclusion_changed', p_actor, p_counts, v_round.official_holes,
          COALESCE(p_ack_mixed, false) AND v_mixed, jsonb_build_object('from', v_round.counts_toward_event, 'to', p_counts));
  RETURN jsonb_build_object('ok', true, 'counts_toward_event', p_counts);
END $$;

CREATE OR REPLACE FUNCTION public.refresh_round_official_results(p_round_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_round public.rounds%ROWTYPE; v_changed uuid[]; v_added uuid[]; v_removed uuid[];
BEGIN
  SELECT * INTO v_round FROM public.rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  IF NOT v_round.closed_early OR v_round.official_holes IS NULL THEN RAISE EXCEPTION 'NO_OFFICIAL_RESULTS_TO_REFRESH'; END IF;

  DROP TABLE IF EXISTS pg_temp._fresh;
  CREATE TEMP TABLE _fresh ON COMMIT DROP AS
    SELECT * FROM public.round_official_snapshot(p_round_id, v_round.official_holes);

  SELECT COALESCE(array_agg(f.player_id), ARRAY[]::uuid[]) INTO v_changed
    FROM _fresh f JOIN public.round_official_results r ON r.round_id = p_round_id AND r.player_id = f.player_id
   WHERE (r.result_kind, r.official_points, r.holes_played, r.actual_points, r.segment_holes, r.segment_points)
         IS DISTINCT FROM (f.result_kind, f.official_points, f.holes_played, f.actual_points, f.segment_holes, f.segment_points);
  SELECT COALESCE(array_agg(f.player_id), ARRAY[]::uuid[]) INTO v_added
    FROM _fresh f WHERE NOT EXISTS (SELECT 1 FROM public.round_official_results r WHERE r.round_id = p_round_id AND r.player_id = f.player_id);
  SELECT COALESCE(array_agg(r.player_id), ARRAY[]::uuid[]) INTO v_removed
    FROM public.round_official_results r WHERE r.round_id = p_round_id AND NOT EXISTS (SELECT 1 FROM _fresh f WHERE f.player_id = r.player_id);

  DELETE FROM public.round_official_results r WHERE r.round_id = p_round_id AND NOT EXISTS (SELECT 1 FROM _fresh f WHERE f.player_id = r.player_id);
  INSERT INTO public.round_official_results
    (round_id, player_id, scorecard_id, result_kind, start_hole, holes_played, actual_points,
     playing_handicap, segment_holes, segment_points, official_points, computed_by)
  SELECT p_round_id, f.player_id, f.scorecard_id, f.result_kind, f.start_hole, f.holes_played, f.actual_points,
         f.playing_handicap, f.segment_holes, f.segment_points, f.official_points, p_actor FROM _fresh f
  ON CONFLICT (round_id, player_id) DO UPDATE SET
    scorecard_id = EXCLUDED.scorecard_id, result_kind = EXCLUDED.result_kind, start_hole = EXCLUDED.start_hole,
    holes_played = EXCLUDED.holes_played, actual_points = EXCLUDED.actual_points,
    playing_handicap = EXCLUDED.playing_handicap, segment_holes = EXCLUDED.segment_holes, segment_points = EXCLUDED.segment_points,
    official_points = EXCLUDED.official_points, computed_at = now(), computed_by = EXCLUDED.computed_by;

  -- Never leave an included round with nobody qualifying
  IF v_round.counts_toward_event AND NOT EXISTS (SELECT 1 FROM public.round_official_results WHERE round_id = p_round_id AND result_kind = 'qualifying') THEN
    RAISE EXCEPTION 'NO_QUALIFYING_PLAYERS';
  END IF;

  INSERT INTO public.round_early_finish_events
    (trip_id, round_id, action, actor_id, counts_toward_event, official_holes, details)
  VALUES (v_round.trip_id, p_round_id, 'results_refreshed', p_actor, v_round.counts_toward_event, v_round.official_holes,
          jsonb_build_object('changed', v_changed, 'added', v_added, 'removed', v_removed));
  RETURN jsonb_build_object('ok', true, 'changed', cardinality(v_changed), 'added', cardinality(v_added), 'removed', cardinality(v_removed));
END $$;

-- Server-only: callable by the service role (the app's API routes), never directly by clients.
REVOKE ALL ON FUNCTION public.round_official_snapshot(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.official_snapshot_is_mixed(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_round_early(uuid, uuid, text, text, boolean, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_round_early_inclusion(uuid, uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_round_official_results(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.round_official_snapshot(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.official_snapshot_is_mixed(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_round_early(uuid, uuid, text, text, boolean, integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_round_early_inclusion(uuid, uuid, boolean, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_round_official_results(uuid, uuid) TO service_role;
