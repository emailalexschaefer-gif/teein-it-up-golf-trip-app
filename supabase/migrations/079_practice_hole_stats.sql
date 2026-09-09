-- =============================================================================
-- 079_practice_hole_stats.sql
-- =============================================================================
-- Practice Stats + My Stats + My Golf Progression (8 Sep).
--
-- TWO THINGS, deliberately narrow, per the explicit "do not overload
-- core Event score_entries" instruction:
--
--   1. rounds.track_practice_stats -- persists the ONE setup choice
--      ("Track Practice Stats?") so refresh/re-entry knows whether
--      stats were enabled, per the explicit "do not infer stat
--      tracking merely from whether some stats happen to exist"
--      instruction. Lives on rounds (not trips) because it is a
--      round-level setup choice, exactly like score_capture_mode and
--      holes already are on this same table -- consistent with the
--      existing pattern, not a new one. NOT NULL DEFAULT false: every
--      existing round (Practice or Event) is unambiguously "stats not
--      tracked" the moment this column appears, and every existing
--      Event round stays completely unaffected since nothing reads
--      this column outside Practice-scoped code paths.
--
--   2. practice_hole_stats -- one narrow, Practice-specific table,
--      exactly the shape requested: fairway_hit/gir/putts, all
--      NULLABLE (missing is a real, distinct third state from Yes/No,
--      per the explicit "missing is NOT the same as No" rule -- a
--      NOT NULL column with a default would silently collapse that
--      distinction). Keyed by scorecard_id + hole_number, not by
--      round_id/player_id/hole_number separately: a scorecard already
--      uniquely identifies one player's one round (confirmed by
--      reading scorecards' own schema before choosing this), so this
--      is the narrowest correct key, not an arbitrary simplification.
--      UNIQUE(scorecard_id, hole_number) is what makes the upsert in
--      the API route idempotent -- "one row/state per golfer + Practice
--      round + hole" is enforced by the database itself, not just by
--      application code being careful.
--
-- Safe for existing data: rounds.track_practice_stats defaults false
-- for every row that already exists; practice_hole_stats is a new,
-- empty table with no existing rows to reconcile. Existing Practice
-- rounds without any stats keep working exactly as before -- reading
-- for a round with track_practice_stats = false (or no rows in this
-- table at all) is simply an empty result set, never an error.
--
-- RLS: mirrors scorecards' own ownership model -- any trip member can
-- read (matching scorecards' own SELECT policy), only the scorecard's
-- own player can write, since Practice is always solo this is
-- equivalent in practice to "only the golfer themselves," without
-- inventing a new permission concept for a table that will only ever
-- have one player per round.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

ALTER TABLE public.rounds
  ADD COLUMN IF NOT EXISTS track_practice_stats BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.rounds.track_practice_stats IS
  'Practice setup choice, persisted explicitly -- never inferred from whether practice_hole_stats rows happen to exist for this round.';

CREATE TABLE IF NOT EXISTS public.practice_hole_stats (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  scorecard_id  UUID        NOT NULL REFERENCES public.scorecards(id) ON DELETE CASCADE,
  hole_number   INTEGER     NOT NULL CHECK (hole_number BETWEEN 1 AND 18),
  fairway_hit   BOOLEAN,    -- nullable: missing is a real third state, not "No"
  gir           BOOLEAN,    -- nullable: same rule
  putts         INTEGER     CHECK (putts IS NULL OR putts BETWEEN 0 AND 20),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scorecard_id, hole_number)
);

CREATE INDEX IF NOT EXISTS practice_hole_stats_scorecard_id_idx ON public.practice_hole_stats(scorecard_id);

ALTER TABLE public.practice_hole_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Trip members: view" ON public.practice_hole_stats;
CREATE POLICY "Trip members: view" ON public.practice_hole_stats FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.scorecards sc
      JOIN public.rounds r ON r.id = sc.round_id
      WHERE sc.id = practice_hole_stats.scorecard_id AND public.is_trip_member(r.trip_id)
    )
  );

DROP POLICY IF EXISTS "Own scorecard: write" ON public.practice_hole_stats;
CREATE POLICY "Own scorecard: write" ON public.practice_hole_stats FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.scorecards sc WHERE sc.id = practice_hole_stats.scorecard_id AND sc.player_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.scorecards sc WHERE sc.id = practice_hole_stats.scorecard_id AND sc.player_id = auth.uid())
  );

NOTIFY pgrst, 'reload schema';
