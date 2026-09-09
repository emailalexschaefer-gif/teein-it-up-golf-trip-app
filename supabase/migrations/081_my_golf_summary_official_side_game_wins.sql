-- =============================================================================
-- 081_my_golf_summary_official_side_game_wins.sql
-- =============================================================================
-- My Golf Side Games -- live status + official round winners (9 Sep).
--
-- ROOT CAUSE, confirmed by reading 075's own exact, current
-- my_side_game_wins CTE directly before writing this (reproduced
-- verbatim below except for the one deliberate change): it joined
-- t.status = 'completed' on the TRIP, not the round. For a
-- multi-round Event, Round 1's Side Game winner would not count as an
-- official My Golf win until every round on that trip finished --
-- wrong per the explicit "Round 1 winner must already appear as an
-- official My Golf Side Game Win" while the Event/trip may still be
-- live.
--
-- FIX: my_side_game_wins now reads directly from
-- side_comps.official_winner_entry_id (migration 080) -- set exactly
-- once, at the moment that specific ROUND closes, by
-- finalize_side_comp_winners(). This is now the sole, authoritative
-- signal; trip.status is no longer consulted for this count at all.
-- A still-live round's current leader has no official_winner_entry_id
-- yet and correctly does not count, matching "do NOT increment Side
-- Game Wins while round is LIVE."
--
-- Practice exclusion preserved via is_practice = false on the trips
-- join, as defence in depth -- Practice never creates side_comps at
-- all (confirmed in an earlier pass), so this join is not expected to
-- ever matter in practice, but costs nothing to keep explicit.
--
-- Every other CTE (my_events, my_badges, player_trip_totals,
-- trip_max_totals, my_event_wins, latest_badge) is reproduced
-- unchanged, verbatim, from 075's own current body -- confirmed by
-- direct comparison before writing this file, not retyped from
-- memory.
--
-- HISTORICAL DATA: migration 080's own backfill already populated
-- official_winner_entry_id for every already-completed round's Side
-- Games using this exact same "latest verified lead change" rule, so
-- existing completed-event totals are unaffected by this change --
-- confirmed as a design property of 080, not re-derived here.
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
  my_side_game_wins AS (
    SELECT scp.id AS side_comp_id
    FROM public.side_comps scp
    JOIN public.side_comp_entries sce ON sce.id = scp.official_winner_entry_id
    JOIN public.trips t ON t.id = scp.trip_id AND t.is_practice = false
    WHERE scp.official_winner_entry_id IS NOT NULL
      AND sce.player_id = p_player_id
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
