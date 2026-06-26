-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION 004: Scoring Engine
-- Rounds, holes, scorecards, score entries, Stableford calculation.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Enums ────────────────────────────────────────────────────────────────────
CREATE TYPE scoring_format AS ENUM (
  'stableford',
  'stroke',
  'match_play',
  'ambrose',
  'four_ball_better_ball'
);

CREATE TYPE round_status AS ENUM ('upcoming', 'active', 'completed');

CREATE TYPE scorecard_status AS ENUM ('active', 'completed', 'withdrawn');

-- ─── rounds ───────────────────────────────────────────────────────────────────
CREATE TABLE public.rounds (
  id             UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id        UUID           NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  course_id      UUID           REFERENCES public.trip_courses(id) ON DELETE SET NULL,
  name           TEXT           NOT NULL,
  play_date      DATE           NOT NULL,
  scoring_format scoring_format NOT NULL DEFAULT 'stableford',
  status         round_status   NOT NULL DEFAULT 'upcoming',
  holes          INTEGER        NOT NULL DEFAULT 18 CHECK (holes IN (9, 18)),
  created_at     TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX rounds_trip_id_idx ON public.rounds(trip_id);

ALTER TABLE public.rounds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view rounds"
  ON public.rounds FOR SELECT
  USING (public.is_trip_member(trip_id));
CREATE POLICY "Organisers can manage rounds"
  ON public.rounds FOR ALL
  USING (public.is_trip_organiser(trip_id))
  WITH CHECK (public.is_trip_organiser(trip_id));

-- ─── holes ────────────────────────────────────────────────────────────────────
CREATE TABLE public.holes (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id     UUID    NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  hole_number  INTEGER NOT NULL CHECK (hole_number BETWEEN 1 AND 18),
  par          INTEGER NOT NULL CHECK (par BETWEEN 3 AND 6),
  stroke_index INTEGER NOT NULL CHECK (stroke_index BETWEEN 1 AND 18),

  UNIQUE (round_id, hole_number),
  UNIQUE (round_id, stroke_index)
);

CREATE INDEX holes_round_id_idx ON public.holes(round_id);

ALTER TABLE public.holes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view holes"
  ON public.holes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.rounds r
      WHERE r.id = holes.round_id
        AND public.is_trip_member(r.trip_id)
    )
  );
CREATE POLICY "Organisers can manage holes"
  ON public.holes FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.rounds r
      WHERE r.id = holes.round_id
        AND public.is_trip_organiser(r.trip_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.rounds r
      WHERE r.id = holes.round_id
        AND public.is_trip_organiser(r.trip_id)
    )
  );

-- ─── Stableford calculation function ─────────────────────────────────────────
-- This is the authoritative calculation. The client-side TypeScript mirrors
-- this exactly for optimistic UI — if they ever diverge, this function wins.
CREATE OR REPLACE FUNCTION public.calculate_stableford_points(
  p_gross_score     INTEGER,
  p_par             INTEGER,
  p_stroke_index    INTEGER,
  p_playing_handicap INTEGER
)
RETURNS INTEGER AS $$
DECLARE
  v_full_strokes    INTEGER;
  v_extra_stroke    INTEGER;
  v_handicap_strokes INTEGER;
  v_net_score       INTEGER;
  v_score_vs_par    INTEGER;
  v_points          INTEGER;
BEGIN
  -- How many strokes does this player receive on this hole?
  v_full_strokes     := p_playing_handicap / 18;
  v_extra_stroke     := CASE WHEN p_stroke_index <= (p_playing_handicap % 18) THEN 1 ELSE 0 END;
  v_handicap_strokes := v_full_strokes + v_extra_stroke;

  v_net_score    := p_gross_score - v_handicap_strokes;
  v_score_vs_par := v_net_score - p_par;

  -- Points: max(0, 2 - score_vs_par), capped at 5
  v_points := LEAST(5, GREATEST(0, 2 - v_score_vs_par));

  RETURN v_points;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ─── scorecards ───────────────────────────────────────────────────────────────
CREATE TABLE public.scorecards (
  id               UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id         UUID              NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  player_id        UUID              NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  playing_handicap INTEGER           NOT NULL DEFAULT 0,
  status           scorecard_status  NOT NULL DEFAULT 'active',
  submitted_at     TIMESTAMPTZ,

  UNIQUE (round_id, player_id)
);

CREATE INDEX scorecards_round_id_idx  ON public.scorecards(round_id);
CREATE INDEX scorecards_player_id_idx ON public.scorecards(player_id);

ALTER TABLE public.scorecards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view scorecards"
  ON public.scorecards FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.rounds r
      WHERE r.id = scorecards.round_id
        AND public.is_trip_member(r.trip_id)
    )
  );
CREATE POLICY "Players can manage own scorecard"
  ON public.scorecards FOR ALL
  USING (player_id = auth.uid())
  WITH CHECK (player_id = auth.uid());
CREATE POLICY "Organisers can manage all scorecards"
  ON public.scorecards FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.rounds r
      WHERE r.id = scorecards.round_id
        AND public.is_trip_organiser(r.trip_id)
    )
  );

-- ─── score_entries ────────────────────────────────────────────────────────────
CREATE TABLE public.score_entries (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  scorecard_id    UUID        NOT NULL REFERENCES public.scorecards(id) ON DELETE CASCADE,
  hole_id         UUID        NOT NULL REFERENCES public.holes(id) ON DELETE CASCADE,
  gross_score     INTEGER     NOT NULL CHECK (gross_score BETWEEN 1 AND 20),
  stableford_pts  INTEGER,         -- computed by trigger on insert/update
  is_no_return    BOOLEAN     NOT NULL DEFAULT false,
  entered_by      UUID        NOT NULL REFERENCES public.profiles(id),
  entered_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_id       TEXT        NOT NULL,  -- UUID from device for idempotency

  -- One score per hole per player
  UNIQUE (scorecard_id, hole_id),
  -- Idempotent sync: same client entry = same row
  UNIQUE (client_id)
);

CREATE INDEX score_entries_scorecard_id_idx ON public.score_entries(scorecard_id);
CREATE INDEX score_entries_hole_id_idx      ON public.score_entries(hole_id);

-- ─── Trigger: auto-compute Stableford points on INSERT/UPDATE ─────────────────
CREATE OR REPLACE FUNCTION public.compute_stableford_on_entry()
RETURNS TRIGGER AS $$
DECLARE
  v_par             INTEGER;
  v_stroke_index    INTEGER;
  v_playing_handicap INTEGER;
BEGIN
  -- Get hole data
  SELECT par, stroke_index
  INTO v_par, v_stroke_index
  FROM public.holes
  WHERE id = NEW.hole_id;

  -- Get player's playing handicap for this round
  SELECT playing_handicap
  INTO v_playing_handicap
  FROM public.scorecards
  WHERE id = NEW.scorecard_id;

  -- Compute and store (0 if no_return)
  IF NEW.is_no_return THEN
    NEW.stableford_pts := 0;
  ELSE
    NEW.stableford_pts := public.calculate_stableford_points(
      NEW.gross_score,
      v_par,
      v_stroke_index,
      v_playing_handicap
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER score_entries_compute_stableford
  BEFORE INSERT OR UPDATE OF gross_score, is_no_return
  ON public.score_entries
  FOR EACH ROW EXECUTE FUNCTION public.compute_stableford_on_entry();

-- ─── RLS — score_entries ──────────────────────────────────────────────────────
ALTER TABLE public.score_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view all scores in their trips"
  ON public.score_entries FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.scorecards sc
      JOIN public.rounds r ON r.id = sc.round_id
      WHERE sc.id = score_entries.scorecard_id
        AND public.is_trip_member(r.trip_id)
    )
  );

-- Players write their own scores via /api/scores route (server validates)
-- This policy allows the server-side client to insert after validation
CREATE POLICY "Authenticated users can insert scores"
  ON public.score_entries FOR INSERT
  WITH CHECK (entered_by = auth.uid());

-- Organisers can update scores (conflict resolution)
CREATE POLICY "Organisers can update scores"
  ON public.score_entries FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.scorecards sc
      JOIN public.rounds r ON r.id = sc.round_id
      WHERE sc.id = score_entries.scorecard_id
        AND public.is_trip_organiser(r.trip_id)
    )
  );
