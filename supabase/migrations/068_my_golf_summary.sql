-- =============================================================================
-- 068_my_golf_summary.sql
-- =============================================================================
-- Homepage "My Golf" achievement summary — one efficient aggregate RPC,
-- per the explicit "avoid N+1 queries... if a dedicated aggregate
-- query/helper is warranted, implement it cleanly" instruction. A
-- single round-trip returning all four numbers, rather than the API
-- route making several separate queries per player on every Home load.
--
-- Every number below is derived from data that already exists and is
-- already the authoritative source elsewhere in this app — nothing new
-- is invented or fabricated to populate this UI:
--
--   events_played — DISTINCT trips where this player has at least one
--     scorecard ever created. A scorecard only exists once begin_round()
--     has actually run for that round, so this is a genuine "actually
--     played," not "was invited" or "joined a draft that never
--     started." trip_members' own UNIQUE(trip_id, profile_id)
--     constraint already rules out duplicate memberships structurally
--     — nothing extra needed here for that.
--
--   badges — COUNT of entries across every published_round_highlights
--     row (the organiser-curated, genuinely "official" highlight set —
--     see migration 066) for this player's trips, where this player is
--     the subject. This is the one badge signal that genuinely exists
--     today; there is no separate permanent-badge table, and this
--     function does not invent one.
--
--   event_wins — COUNT of COMPLETED trips where this player has the
--     (possibly tied) highest total Stableford points among that
--     trip's participants. Documented simplification, not silently
--     passed off as identical to the canonical countback-aware
--     standings elsewhere in this app (multiRound.ts's
--     computeCumulativeStandings): a genuine points tie here counts as
--     a win for every tied player, without the hole-by-hole countback
--     ladder used for official Final Results. For a homepage dopamine
--     summary this is a reasonable, honest trade-off against the cost
--     of recomputing full countback for every trip a player has ever
--     been in; it is not used anywhere a precise, disputed-result-grade
--     answer is required.
--
--   side_game_wins — COUNT of side_comp_lead_changes rows where this
--     player holds the LATEST (highest sequence_number) entry for that
--     side_comp_id — i.e. the genuine final leader, reusing the
--     existing append-only leadership log exactly as designed (see
--     migration 037's own comment: "written exactly once per genuine
--     leadership change") — restricted to COMPLETED trips only, so an
--     in-progress claim never counts as a "win" prematurely.
--
--   latest_badge_title — the title of the most recently published
--     highlight (by published_at) where this player is the subject,
--     across all their trips. Null if none exist — the caller must not
--     fabricate one.
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
    JOIN public.trips t ON t.id = r.trip_id AND t.status = 'completed'
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
    JOIN public.trips t ON t.id = scp.trip_id AND t.status = 'completed'
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
