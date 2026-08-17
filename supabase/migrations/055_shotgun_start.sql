-- =============================================================================
-- 055_shotgun_start.sql
-- =============================================================================
-- Shotgun Start V1. Deliberately does NOT introduce a second scoring
-- engine — scorecards, score_entries, compute_stableford, reconciliation,
-- round_markers (Playing Partner), and side_comps are all completely
-- untouched. This migration only adds the two pieces of new information
-- Shotgun genuinely needs: which start type a round is, and which hole
-- each group starts on for that round.
--
-- start_type on rounds — 'standard' (default, existing behaviour
-- unchanged) or 'shotgun'. A round-level property, not a trip-level
-- one, since different rounds of the same trip could reasonably use
-- different formats.
--
-- round_group_starting_holes — round + group scoped, exactly matching
-- round_group_tee_times' own (round_id, group_id) pattern from
-- migration 053, not a new modelling convention. A group with no row
-- here has no assigned starting hole for that round — the player-side
-- fallback picker (not the database) is what handles that case, so
-- there's no default value baked in here to accidentally treat as a
-- real assignment.
--
-- No historical rewrite risk: each row is keyed by (round_id,
-- group_id), so assigning/editing Round 2's starting holes can never
-- touch Round 1's — the same guarantee round_group_tee_times already
-- has, for the same structural reason.
-- =============================================================================

ALTER TABLE public.rounds
  ADD COLUMN IF NOT EXISTS start_type TEXT NOT NULL DEFAULT 'standard'
    CHECK (start_type IN ('standard', 'shotgun'));

CREATE TABLE IF NOT EXISTS public.round_group_starting_holes (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id      UUID        NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  group_id      UUID        NOT NULL REFERENCES public.trip_groups(id) ON DELETE CASCADE,
  starting_hole INTEGER     NOT NULL CHECK (starting_hole >= 1 AND starting_hole <= 18),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (round_id, group_id)
);

CREATE INDEX IF NOT EXISTS round_group_starting_holes_round_idx ON public.round_group_starting_holes(round_id);

ALTER TABLE public.round_group_starting_holes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trip members: view" ON public.round_group_starting_holes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.rounds r WHERE r.id = round_group_starting_holes.round_id
        AND public.is_trip_member(r.trip_id)
    )
  );

CREATE POLICY "Organisers: manage" ON public.round_group_starting_holes
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.rounds r WHERE r.id = round_group_starting_holes.round_id
        AND public.is_trip_organiser(r.trip_id)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.rounds r WHERE r.id = round_group_starting_holes.round_id
        AND public.is_trip_organiser(r.trip_id)
    )
  );
