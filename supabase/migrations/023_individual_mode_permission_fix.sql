-- =============================================================================
-- 023: Fix score_entry_capture_allowed() for 'individual' mode
-- =============================================================================
-- Review caught a real bug: the function from migration 022 only special-
-- cased 'group_scorer' mode; everything else (both 'self_and_marker' AND
-- 'individual') fell into the same branch, which allowed a 'marker'-role
-- write whenever a round_markers row happened to match — even in
-- 'individual' mode, which is supposed to have no marker concept at all.
--
-- This migration makes 'individual' mode structurally incapable of
-- accepting a marker-role write, mirroring the fix in
-- src/lib/scoring/captureMode.ts (now the single source of truth on the TS
-- side, with test coverage for exactly this case).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.score_entry_capture_allowed(p_scorecard_id UUID, p_capture_role TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_round_id      UUID;
  v_trip_id       UUID;
  v_target_player UUID;
  v_mode          TEXT;
BEGIN
  SELECT sc.round_id, r.trip_id, sc.player_id, r.score_capture_mode
    INTO v_round_id, v_trip_id, v_target_player, v_mode
  FROM public.scorecards sc
  JOIN public.rounds r ON r.id = sc.round_id
  WHERE sc.id = p_scorecard_id;

  IF v_round_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Organisers may always write, in any mode.
  IF public.is_trip_organiser(v_trip_id) THEN
    RETURN TRUE;
  END IF;

  IF v_mode = 'group_scorer' THEN
    -- Legacy model: only 'self'-role entries exist; same-playing-group
    -- members may write one for any member of their group.
    RETURN p_capture_role = 'self' AND public.same_playing_group(p_scorecard_id);
  END IF;

  IF v_mode = 'individual' THEN
    -- Genuinely single-capture: no marker concept applies here at all. A
    -- marker-role write is never allowed, regardless of any stray
    -- round_markers row — this mode simply doesn't consult that table.
    RETURN p_capture_role = 'self' AND v_target_player = auth.uid();
  END IF;

  -- self_and_marker (the default):
  IF p_capture_role = 'self' THEN
    RETURN v_target_player = auth.uid();
  ELSIF p_capture_role = 'marker' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.round_markers rm
      WHERE rm.round_id = v_round_id
        AND rm.player_id = v_target_player
        AND rm.marker_player_id = auth.uid()
    );
  END IF;

  RETURN FALSE;
END;
$$;

-- Verification:
-- select proname from pg_proc where proname = 'score_entry_capture_allowed';
-- Manual check: with a round in 'individual' mode and a (contrived) stray
-- round_markers row for some player, confirm an INSERT with
-- capture_role='marker' against that player's scorecard is rejected by RLS.
