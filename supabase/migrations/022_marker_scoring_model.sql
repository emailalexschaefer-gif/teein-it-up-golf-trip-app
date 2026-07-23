-- =============================================================================
-- 022: Self + Marker Score-Capture Model
-- =============================================================================
-- Changes the default Sprint 5B scoring model from "one scorer enters the
-- whole group" to "each player enters their own score AND one nominated
-- marker partner's score" (MiScore-style). The old group-scorer model is
-- NOT deleted — it's kept as an explicit round-level mode for charity days /
-- corporate events / single-app-user groups, selected via
-- rounds.score_capture_mode.
--
-- Existing score_entries rows are NOT reinterpreted as verified marker
-- scores. They default to capture_role = 'self' — the same single
-- authoritative-capture meaning they always had. No data is silently
-- upgraded to something it wasn't.
-- =============================================================================

-- ── 1. Round-level capture mode ─────────────────────────────────────────────
ALTER TABLE public.rounds
  ADD COLUMN IF NOT EXISTS score_capture_mode TEXT NOT NULL DEFAULT 'self_and_marker'
    CHECK (score_capture_mode IN ('self_and_marker', 'group_scorer', 'individual'));

-- ── 2. capture_role on score_entries ─────────────────────────────────────────
-- Each player-hole result now needs up to two INDEPENDENT captures (self and
-- marker), so the old UNIQUE(scorecard_id, hole_id) has to widen to include
-- capture_role. Existing rows become capture_role = 'self' — this is a
-- column default, not a reinterpretation of what the data means.
ALTER TABLE public.score_entries
  ADD COLUMN IF NOT EXISTS capture_role TEXT NOT NULL DEFAULT 'self'
    CHECK (capture_role IN ('self', 'marker'));

-- A genuine pick-up (no return) can now have no gross score at all, matching
-- the comparison model's "pickedUp is its own dimension, not a stand-in
-- score." Previously gross_score was NOT NULL, forcing every pick-up to
-- store a placeholder number.
ALTER TABLE public.score_entries ALTER COLUMN gross_score DROP NOT NULL;
ALTER TABLE public.score_entries DROP CONSTRAINT IF EXISTS score_entries_gross_score_check;
ALTER TABLE public.score_entries ADD CONSTRAINT score_entries_gross_score_check
  CHECK (
    (is_no_return AND gross_score IS NULL)
    OR (gross_score IS NOT NULL AND gross_score BETWEEN 1 AND 20)
  );

ALTER TABLE public.score_entries DROP CONSTRAINT IF EXISTS score_entries_scorecard_id_hole_id_key;
ALTER TABLE public.score_entries ADD CONSTRAINT score_entries_scorecard_hole_role_key
  UNIQUE (scorecard_id, hole_id, capture_role);

-- ── 3. round_markers — who marks whom, per round ─────────────────────────────
-- One row per (round, player) pair: "marker_player_id enters scores on behalf
-- of player_id, in addition to player_id's own entry." Directional, so a
-- 3-player circular assignment (Alex→Darren→Sam→Alex) is representable
-- without forcing symmetry.
CREATE TABLE IF NOT EXISTS public.round_markers (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id          UUID        NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  player_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  marker_player_id  UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (round_id, player_id),
  CHECK (player_id != marker_player_id)
);

CREATE INDEX IF NOT EXISTS round_markers_round_id_idx ON public.round_markers(round_id);
CREATE INDEX IF NOT EXISTS round_markers_marker_idx    ON public.round_markers(round_id, marker_player_id);

ALTER TABLE public.round_markers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members: view marker assignments" ON public.round_markers FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.rounds r WHERE r.id = round_markers.round_id AND public.is_trip_member(r.trip_id)));

-- Only organisers manage assignments (players may not reassign their own marker).
CREATE POLICY "Organisers: manage marker assignments" ON public.round_markers FOR ALL
  USING (EXISTS (SELECT 1 FROM public.rounds r WHERE r.id = round_markers.round_id AND public.is_trip_organiser(r.trip_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rounds r WHERE r.id = round_markers.round_id AND public.is_trip_organiser(r.trip_id)));

-- ── 4. Mode-aware permission function ────────────────────────────────────────
-- Replaces same_playing_group() as the primary check for score_entries
-- writes, but same_playing_group() is NOT dropped — group_scorer mode still
-- uses it, unchanged, for trips that explicitly choose that mode.
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

  -- Organisers may always write, in any mode — "inspect any mismatch, make
  -- authorised corrections where necessary."
  IF public.is_trip_organiser(v_trip_id) THEN
    RETURN TRUE;
  END IF;

  IF v_mode = 'group_scorer' THEN
    -- Legacy model, explicitly opted into: any group member can write a
    -- 'self'-role entry for any scorecard in their playing group. Marker
    -- captures don't apply in this mode.
    RETURN p_capture_role = 'self' AND public.same_playing_group(p_scorecard_id);
  END IF;

  -- self_and_marker (default) and individual modes:
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

-- ── 5. Replace score_entries write policies ──────────────────────────────────
DROP POLICY IF EXISTS "Group: insert scores"           ON public.score_entries;
DROP POLICY IF EXISTS "Players: update group scores"   ON public.score_entries;
DROP POLICY IF EXISTS "Organisers: update scores"      ON public.score_entries;

CREATE POLICY "Capture model: insert scores" ON public.score_entries FOR INSERT
  WITH CHECK (
    entered_by = auth.uid()
    AND public.score_entry_capture_allowed(scorecard_id, capture_role)
    AND public.hole_matches_scorecard_round(scorecard_id, hole_id)
  );

CREATE POLICY "Capture model: update scores" ON public.score_entries FOR UPDATE
  USING (public.score_entry_capture_allowed(scorecard_id, capture_role))
  WITH CHECK (
    public.score_entry_capture_allowed(scorecard_id, capture_role)
    AND public.hole_matches_scorecard_round(scorecard_id, hole_id)
  );

-- SELECT policy ("Members: view scores") from migration 004 is unchanged —
-- any trip member can read all score_entries for rounds on their trip. The
-- app layer narrows what's actually shown per the permission rules in
-- point 9 of the brief (a player reads comparison status only for their own
-- scorecard and the player they mark) — this is a UX narrowing, same
-- pattern as the group-scoring UI already uses, not a security boundary,
-- since scorecard data itself isn't sensitive between trip members.

-- Verification:
-- select column_name from information_schema.columns where table_name='rounds' and column_name='score_capture_mode';
-- select column_name from information_schema.columns where table_name='score_entries' and column_name='capture_role';
-- select conname from pg_constraint where conname = 'score_entries_scorecard_hole_role_key';
-- select proname from pg_proc where proname = 'score_entry_capture_allowed';
