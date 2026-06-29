-- ─────────────────────────────────────────────────────────────────────────────
-- 004: Scoring Engine
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.rounds (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id        UUID        NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  course_id      UUID,       -- optional FK to trip_courses (added later if needed)
  course_name    TEXT,       -- denormalised for simple display
  name           TEXT        NOT NULL,
  play_date      DATE        NOT NULL,
  tee_time       TEXT,       -- stored as 'HH:MM' text
  scoring_format TEXT        NOT NULL DEFAULT 'stableford'
                             CHECK (scoring_format IN (
                               'stableford','stroke','match_play','ambrose','four_ball_better_ball'
                             )),
  status         TEXT        NOT NULL DEFAULT 'upcoming'
                             CHECK (status IN ('upcoming','active','completed')),
  holes          INTEGER     NOT NULL DEFAULT 18 CHECK (holes IN (9,18)),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX rounds_trip_id_idx ON public.rounds(trip_id);

ALTER TABLE public.rounds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members: view" ON public.rounds FOR SELECT USING (public.is_trip_member(trip_id));
CREATE POLICY "Organisers: manage" ON public.rounds FOR ALL
  USING (public.is_trip_organiser(trip_id)) WITH CHECK (public.is_trip_organiser(trip_id));

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
CREATE POLICY "Members: view" ON public.holes FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.rounds r WHERE r.id = holes.round_id AND public.is_trip_member(r.trip_id)));
CREATE POLICY "Organisers: manage" ON public.holes FOR ALL
  USING (EXISTS (SELECT 1 FROM public.rounds r WHERE r.id = holes.round_id AND public.is_trip_organiser(r.trip_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rounds r WHERE r.id = holes.round_id AND public.is_trip_organiser(r.trip_id)));

-- ─── Stableford function ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calculate_stableford_points(
  p_gross       INTEGER,
  p_par         INTEGER,
  p_stroke_idx  INTEGER,
  p_handicap    INTEGER
) RETURNS INTEGER LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_strokes INTEGER;
  v_net     INTEGER;
BEGIN
  v_strokes := (p_handicap / 18) + CASE WHEN p_stroke_idx <= (p_handicap % 18) THEN 1 ELSE 0 END;
  v_net     := p_gross - v_strokes;
  RETURN LEAST(5, GREATEST(0, 2 - (v_net - p_par)));
END;
$$;

-- ─── scorecards ───────────────────────────────────────────────────────────────

CREATE TABLE public.scorecards (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id         UUID    NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  player_id        UUID    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  playing_handicap INTEGER NOT NULL DEFAULT 0,
  status           TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','withdrawn')),
  submitted_at     TIMESTAMPTZ,
  UNIQUE (round_id, player_id)
);

CREATE INDEX scorecards_round_id_idx  ON public.scorecards(round_id);
CREATE INDEX scorecards_player_id_idx ON public.scorecards(player_id);

ALTER TABLE public.scorecards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members: view" ON public.scorecards FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.rounds r WHERE r.id = scorecards.round_id AND public.is_trip_member(r.trip_id)));
CREATE POLICY "Players: own scorecard" ON public.scorecards FOR ALL USING (player_id = auth.uid());
CREATE POLICY "Organisers: all scorecards" ON public.scorecards FOR ALL
  USING (EXISTS (SELECT 1 FROM public.rounds r WHERE r.id = scorecards.round_id AND public.is_trip_organiser(r.trip_id)));

-- ─── score_entries ────────────────────────────────────────────────────────────

CREATE TABLE public.score_entries (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  scorecard_id   UUID        NOT NULL REFERENCES public.scorecards(id) ON DELETE CASCADE,
  hole_id        UUID        NOT NULL REFERENCES public.holes(id) ON DELETE CASCADE,
  gross_score    INTEGER     NOT NULL CHECK (gross_score BETWEEN 1 AND 20),
  stableford_pts INTEGER,
  is_no_return   BOOLEAN     NOT NULL DEFAULT false,
  entered_by     UUID        NOT NULL REFERENCES public.profiles(id),
  entered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_id      TEXT        NOT NULL,
  UNIQUE (scorecard_id, hole_id),
  UNIQUE (client_id)
);

CREATE INDEX score_entries_scorecard_id_idx ON public.score_entries(scorecard_id);

-- Auto-compute Stableford on insert/update
CREATE OR REPLACE FUNCTION public.compute_stableford()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_par     INTEGER; v_si INTEGER; v_hc INTEGER;
BEGIN
  SELECT par, stroke_index INTO v_par, v_si FROM public.holes WHERE id = NEW.hole_id;
  SELECT playing_handicap INTO v_hc FROM public.scorecards WHERE id = NEW.scorecard_id;
  NEW.stableford_pts := CASE WHEN NEW.is_no_return THEN 0
    ELSE public.calculate_stableford_points(NEW.gross_score, v_par, v_si, v_hc) END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER score_entries_stableford
  BEFORE INSERT OR UPDATE OF gross_score, is_no_return
  ON public.score_entries
  FOR EACH ROW EXECUTE FUNCTION public.compute_stableford();

ALTER TABLE public.score_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members: view scores" ON public.score_entries FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.scorecards sc
    JOIN public.rounds r ON r.id = sc.round_id
    WHERE sc.id = score_entries.scorecard_id AND public.is_trip_member(r.trip_id)
  ));
CREATE POLICY "Players: insert own scores" ON public.score_entries FOR INSERT
  WITH CHECK (entered_by = auth.uid());
CREATE POLICY "Organisers: update scores" ON public.score_entries FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.scorecards sc
    JOIN public.rounds r ON r.id = sc.round_id
    WHERE sc.id = score_entries.scorecard_id AND public.is_trip_organiser(r.trip_id)
  ));
