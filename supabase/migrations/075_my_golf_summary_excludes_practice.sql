-- =============================================================================
-- 075_my_golf_summary_excludes_practice.sql
-- =============================================================================
-- Separate Solo Event Play from Practice Round Mode (5 Sep).
--
-- ROOT CAUSE, found by reading get_my_golf_summary()'s exact, current
-- body directly (migration 068, never redeclared since): three of its
-- five counters had no is_practice awareness at all, since is_practice
-- didn't exist when this function was written.
--
--   - my_events (events_played) counted every trip with a scorecard,
--     including a Practice trip.
--   - my_event_wins joined trips t ON t.status = 'completed' with no
--     is_practice check -- a solo Practice round, being the only
--     participant, always has the single highest score in that trip
--     and would always count as an "Event Win." This is the specific
--     integrity gap the brief exists to prevent: "do not allow a
--     golfer to manufacture competitive achievement history through
--     unverified solo play."
--   - my_side_game_wins had the identical gap, via the same
--     t.status = 'completed' join with no is_practice check -- moot in
--     practice (this implementation deliberately excludes Side Games
--     from Practice entirely, so no side_comps row should ever exist
--     for one), but fixed here anyway as defence in depth rather than
--     relying solely on Side Games never being set up for a Practice
--     trip.
--
-- my_badges was already safe by construction, not by anything in this
-- function: published_round_highlights can never contain a Practice
-- trip's row at all, since the /published-highlights POST route now
-- explicitly refuses to publish for one (see the application-layer
-- fix alongside this migration) -- no change needed here for that
-- counter, and none made.
--
-- FIX: three JOINs/CTEs gained one additional
-- `AND t.is_practice = false` (or the trips join added where it didn't
-- exist before, for my_events specifically). No other logic changed --
-- same ranking/countback approach, same tie handling
-- (trip_max_totals/my_event_wins), same latest-leader-per-side_comp
-- logic.
--
-- Re-declared here from 068's own exact, directly-viewed-before-
-- writing body, not reconstructed from memory.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_my_golf_summary(p_player_id UUID)
RETURNS TABLE (
  events_played      INTEGER,
  badges             INTEGER,
  event_wins         INTEGER,
  side_game_wins     INTEGER,
  latest_badge_title TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH
  my_events AS (
    SELECT DISTINCT r.trip_id
    FROM public.scorecards sc
    JOIN public.rounds r ON r.id = sc.round_id
    JOIN public.trips t ON t.id = r.trip_id AND t.is_practice = false
    WHERE sc.player_id = p_player_id
  ),
  my_badge_rows AS (
    SELECT prh.highlights, prh.published_at
    FROM public.published_round_highlights prh
    JOIN public.trip_members tm ON tm.trip_id = prh.trip_id AND tm.profile_id = p_player_id
  ),
  my_badges AS (
    SELECT elem, r.published_at
    FROM my_badge_rows r
    CROSS JOIN LATERAL jsonb_array_elements(r.highlights) AS elem
    WHERE elem->>'playerId' = p_player_id::text
  ),
  player_trip_totals AS (
    SELECT r.trip_id, sc.player_id, SUM(COALESCE(se.stableford_pts, 0)) AS total_pts
    FROM public.scorecards sc
    JOIN public.rounds r ON r.id = sc.round_id
    JOIN public.trips t ON t.id = r.trip_id AND t.status = 'completed' AND t.is_practice = false
    LEFT JOIN public.score_entries se ON se.scorecard_id = sc.id AND se.capture_role = 'self'
    GROUP BY r.trip_id, sc.player_id
  ),
  trip_max_totals AS (
    SELECT trip_id, MAX(total_pts) AS max_pts FROM player_trip_totals GROUP BY trip_id
  ),
  my_event_wins AS (
    SELECT ptt.trip_id
    FROM player_trip_totals ptt
    JOIN trip_max_totals tm ON tm.trip_id = ptt.trip_id AND tm.max_pts = ptt.total_pts
    WHERE ptt.player_id = p_player_id
  ),
  latest_leaders AS (
    SELECT DISTINCT ON (side_comp_id) side_comp_id, player_id
    FROM public.side_comp_lead_changes
    ORDER BY side_comp_id, sequence_number DESC
  ),
  my_side_game_wins AS (
    SELECT ll.side_comp_id
    FROM latest_leaders ll
    JOIN public.side_comps scp ON scp.id = ll.side_comp_id
    JOIN public.trips t ON t.id = scp.trip_id AND t.status = 'completed' AND t.is_practice = false
    WHERE ll.player_id = p_player_id
  ),
  latest_badge AS (
    SELECT elem->>'title' AS title
    FROM my_badges
    ORDER BY published_at DESC
    LIMIT 1
  )
  SELECT
    (SELECT COUNT(*)::INTEGER FROM my_events),
    (SELECT COUNT(*)::INTEGER FROM my_badges),
    (SELECT COUNT(*)::INTEGER FROM my_event_wins),
    (SELECT COUNT(*)::INTEGER FROM my_side_game_wins),
    (SELECT title FROM latest_badge);
END;
$$;

NOTIFY pgrst, 'reload schema';
