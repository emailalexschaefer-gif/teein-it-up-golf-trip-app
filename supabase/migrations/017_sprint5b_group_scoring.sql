-- =============================================================================
-- 017: Sprint 5B — Group Scoring Security Model
-- =============================================================================
-- Sprint 5A's RLS only checked `entered_by = auth.uid()`, which meant the DB
-- itself had NO linkage between the person entering a score and the scorecard
-- being scored (any authenticated user could technically write against any
-- scorecard_id). The application layer then over-corrected by hard-blocking
-- anyone but the scorecard owner, which made group scoring impossible.
--
-- This migration introduces the correct, narrower rule at the database level:
-- a score for a scorecard may only be entered/updated by someone who is
-- either (a) that scorecard's own player, (b) in the same trip_group as that
-- player for this round's trip, or (c) the trip organiser.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.same_playing_group(p_scorecard_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip_id       UUID;
  v_target_player UUID;
  v_target_group  UUID;
  v_caller_group  UUID;
BEGIN
  SELECT r.trip_id, sc.player_id
    INTO v_trip_id, v_target_player
  FROM public.scorecards sc
  JOIN public.rounds r ON r.id = sc.round_id
  WHERE sc.id = p_scorecard_id;

  IF v_trip_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Organisers can always score/edit any card on their trip.
  IF public.is_trip_organiser(v_trip_id) THEN
    RETURN TRUE;
  END IF;

  -- Scorecard owner scoring themselves.
  IF v_target_player = auth.uid() THEN
    RETURN TRUE;
  END IF;

  SELECT group_id INTO v_target_group
  FROM public.trip_members
  WHERE trip_id = v_trip_id AND profile_id = v_target_player;

  SELECT group_id INTO v_caller_group
  FROM public.trip_members
  WHERE trip_id = v_trip_id AND profile_id = auth.uid();

  RETURN v_target_group IS NOT NULL AND v_caller_group IS NOT NULL AND v_target_group = v_caller_group;
END;
$$;

-- ── score_entries: replace INSERT policy, add player UPDATE policy ──────────

DROP POLICY IF EXISTS "Players: insert own scores" ON public.score_entries;
CREATE POLICY "Group: insert scores" ON public.score_entries FOR INSERT
  WITH CHECK (entered_by = auth.uid() AND public.same_playing_group(scorecard_id));

DROP POLICY IF EXISTS "Players: update group scores" ON public.score_entries;
CREATE POLICY "Players: update group scores" ON public.score_entries FOR UPDATE
  USING (public.same_playing_group(scorecard_id))
  WITH CHECK (public.same_playing_group(scorecard_id));

-- Organiser UPDATE policy from 004 is kept as-is (redundant now with
-- same_playing_group covering organisers too, but left for defense in depth).
