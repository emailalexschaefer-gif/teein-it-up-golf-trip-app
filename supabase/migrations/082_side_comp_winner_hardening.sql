-- =============================================================================
-- 082_side_comp_winner_hardening.sql
-- =============================================================================
-- Final hardening pass on migrations 080/081, before deployment (9 Sep).
--
-- ==========================================================================
-- 1. RETRY/RECOVERY STRATEGY FOR FINALISATION FAILURE
-- ==========================================================================
-- CHOSEN APPROACH: B (best-effort at close, guaranteed self-healing on
-- read), not A (making finalisation part of the required close
-- transaction).
--
-- Why not A: making finalize_side_comp_winners a hard requirement for
-- round close means a transient Side Games failure (a lock, a network
-- blip, anything) would block the round from closing at all -- an
-- organiser unable to close a round over a Side Games problem is a
-- worse failure mode than a temporarily-unfinalised winner, and the
-- round-close route already has enough server-side guards (marker
-- completion, shared-device detection) that adding another hard
-- dependency here raises the chance of an unrelated failure blocking
-- a close that should otherwise succeed.
--
-- Why B is safe here specifically: finalize_side_comp_winners() is
-- already fully idempotent (its own UPDATE is scoped
-- WHERE official_winner_entry_id IS NULL, confirmed in 080) -- calling
-- it again costs nothing for anything already finalised.
--
-- IMPLEMENTATION: get_my_golf_summary() (called on every My Golf read)
-- now self-heals first -- for the requesting player's own completed
-- rounds, it calls finalize_side_comp_winners() for any of those
-- rounds that still have a side_comp with a NULL
-- official_winner_entry_id, before computing the win count. This means
-- the exact scenario the brief describes (close-time RPC call fails,
-- round still closes, winner never becomes official) self-corrects
-- the very next time that player opens My Golf -- no cron job, no
-- separate recovery endpoint, no reliance on a human noticing and
-- manually retrying. Every read is also a retry opportunity, per the
-- explicit "every subsequent close/read/recovery path safely retry
-- missing finalisation" instruction.
--
-- ==========================================================================
-- 2. INTEGRITY: official_winner_entry_id CANNOT POINT TO ANOTHER SIDE_COMP
-- ==========================================================================
-- INSPECTED FIRST, as instructed: side_comps' own existing RLS policy
-- ("Organisers: manage", FOR ALL, from migration 005/000) grants
-- organisers direct UPDATE access to every column on side_comps,
-- including the new official_winner_entry_id -- meaning a plain FK to
-- side_comp_entries(id) alone does NOT prevent an organiser's client
-- (or any future code path) from setting this to an entry belonging
-- to a completely different competition. finalize_side_comp_winners()
-- itself always writes a correct value, but nothing previously stopped
-- a DIRECT write from being wrong -- a genuine gap, not a theoretical
-- one, confirmed by reading the actual RLS policy before concluding
-- this needed fixing.
--
-- FIX: a BEFORE INSERT OR UPDATE trigger on side_comps, enforced at
-- the database level regardless of caller (organiser client,
-- finalize_side_comp_winners, a future admin tool, anything) --
-- raises an exception if official_winner_entry_id is set to an entry
-- whose own side_comp_id does not match this row's id. This is
-- stronger than documenting "only the trusted function writes this,"
-- which the brief itself flagged as insufficient on its own.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_side_comp_winner_integrity()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_entry_side_comp_id UUID;
BEGIN
  IF NEW.official_winner_entry_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT side_comp_id INTO v_entry_side_comp_id
  FROM public.side_comp_entries WHERE id = NEW.official_winner_entry_id;
  IF v_entry_side_comp_id IS NULL THEN
    RAISE EXCEPTION 'official_winner_entry_id % does not reference a real side_comp_entries row', NEW.official_winner_entry_id;
  END IF;
  IF v_entry_side_comp_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'official_winner_entry_id % belongs to side_comp %, not this side_comp %', NEW.official_winner_entry_id, v_entry_side_comp_id, NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS side_comps_winner_integrity ON public.side_comps;
CREATE TRIGGER side_comps_winner_integrity
  BEFORE INSERT OR UPDATE OF official_winner_entry_id ON public.side_comps
  FOR EACH ROW EXECUTE FUNCTION public.enforce_side_comp_winner_integrity();

-- ==========================================================================
-- Self-healing get_my_golf_summary() -- reconciles this player's own
-- completed rounds' unfinalised side_comps before counting wins.
-- Reproduces 081's exact body verbatim except for this one addition
-- (a new reconciliation step before the existing WITH query), and the
-- my_side_game_wins CTE itself is completely unchanged from 081.
-- ==========================================================================
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
DECLARE
  v_round RECORD;
BEGIN
  -- Self-healing retry (item 1 above) -- for every completed round
  -- this player has a scorecard in, where at least one side_comp on
  -- that round is still unfinalised, call the same idempotent
  -- finalisation function again. Scoped to this player's own rounds
  -- only (not a global scan) so a single My Golf read stays cheap --
  -- the same round gets reconciled the first time ANY of its players
  -- next opens My Golf, which for a live event is normally within
  -- minutes of the round actually closing.
  FOR v_round IN
    SELECT DISTINCT r.id
    FROM public.scorecards sc
    JOIN public.rounds r ON r.id = sc.round_id AND r.status = 'completed'
    JOIN public.side_comps scp ON scp.round_id = r.id AND scp.official_winner_entry_id IS NULL
    WHERE sc.player_id = p_player_id
  LOOP
    PERFORM public.finalize_side_comp_winners(v_round.id);
  END LOOP;

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
