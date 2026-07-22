-- =============================================================================
-- 018: Sprint 5B — Hole/Round Consistency Check in RLS
-- =============================================================================
-- Migration 017 correctly restricted WHO can write a score_entries row
-- (own card / same playing group / organiser), but nothing at the database
-- level confirmed that the hole_id being scored actually belongs to the
-- same round as the scorecard. The API layer checked this, but RLS did not
-- — meaning a compromised or buggy client could otherwise write a score
-- against a hole from a different round. This migration closes that gap
-- directly in Postgres, independent of the API.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.hole_matches_scorecard_round(p_scorecard_id UUID, p_hole_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.scorecards sc
    JOIN public.holes h ON h.round_id = sc.round_id
    WHERE sc.id = p_scorecard_id AND h.id = p_hole_id
  );
$$;

DROP POLICY IF EXISTS "Group: insert scores" ON public.score_entries;
CREATE POLICY "Group: insert scores" ON public.score_entries FOR INSERT
  WITH CHECK (
    entered_by = auth.uid()
    AND public.same_playing_group(scorecard_id)
    AND public.hole_matches_scorecard_round(scorecard_id, hole_id)
  );

DROP POLICY IF EXISTS "Players: update group scores" ON public.score_entries;
CREATE POLICY "Players: update group scores" ON public.score_entries FOR UPDATE
  USING (public.same_playing_group(scorecard_id))
  WITH CHECK (
    public.same_playing_group(scorecard_id)
    AND public.hole_matches_scorecard_round(scorecard_id, hole_id)
  );

DROP POLICY IF EXISTS "Organisers: update scores" ON public.score_entries;
CREATE POLICY "Organisers: update scores" ON public.score_entries FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.scorecards sc
    JOIN public.rounds r ON r.id = sc.round_id
    WHERE sc.id = score_entries.scorecard_id AND public.is_trip_organiser(r.trip_id)
  ))
  WITH CHECK (public.hole_matches_scorecard_round(scorecard_id, hole_id));
