-- ═════════════════════════════════════════════════════════════════════════════
-- TEEIN' IT UP — COMBINED FRESH DATABASE MIGRATION
-- ═════════════════════════════════════════════════════════════════════════════
-- Use this single file to set up a brand-new Supabase database in one step.
-- Run it in Supabase → SQL Editor → New query → paste → Run.
--
-- Alternatively run migrations 001–006 individually in order.
-- Both approaches produce an identical schema.
--
-- Prerequisites:
--   • Supabase project created
--   • Authentication → Email provider enabled
--   • Authentication → Magic Links / OTP enabled
-- ═════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- BEGIN: 001_profiles.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 001: Profiles
-- Run first. Requires Supabase Auth to be enabled on the project.
--
-- NOTE: The RLS policy "Trip members can view each other" is intentionally
-- NOT here. It references public.trip_members which doesn't exist until
-- migration 002. That policy is applied at the end of 002_trips.sql.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE public.profiles (
  id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT        NOT NULL,
  full_name   TEXT        NOT NULL DEFAULT '',
  avatar_url  TEXT,
  handicap    DECIMAL(4,1),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Auto-create profile on sign-up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can read and update their own profile
CREATE POLICY "Own profile: full access"
  ON public.profiles FOR ALL
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Cross-table policy added in 002_trips.sql after trip_members is created:
--   "Trip members can view each other"


-- ─────────────────────────────────────────────────────────────────────────────
-- BEGIN: 002_trips.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 002: Trips & Trip Members
-- Also applies the cross-table profiles RLS policy that requires trip_members.
-- ─────────────────────────────────────────────────────────────────────────────

-- Invite code generator (6-char alphanumeric, no ambiguous chars)
CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code  TEXT := '';
  i     INT;
BEGIN
  FOR i IN 1..6 LOOP
    code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN code;
END;
$$;

CREATE TABLE public.trips (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organiser_id     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL,
  description      TEXT,
  event_type       TEXT        DEFAULT 'golf_trip'
                               CHECK (event_type IN (
                                 'golf_trip','corporate_day','charity_day',
                                 'golf_society','bucks_weekend','other'
                               )),
  location         TEXT,
  start_date       DATE        NOT NULL,
  end_date         DATE        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft','open','ready','live','completed','archived')),
  logo_url         TEXT,
  cover_image_url  TEXT,
  invite_code      TEXT        NOT NULL UNIQUE DEFAULT public.generate_invite_code(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT trips_dates_valid CHECK (end_date >= start_date)
);

CREATE TRIGGER trips_updated_at
  BEFORE UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE public.trip_members (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     UUID        NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  profile_id  UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role        TEXT        NOT NULL DEFAULT 'player' CHECK (role IN ('organiser','player')),
  nickname    TEXT,
  team        TEXT,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trip_id, profile_id)
);

CREATE INDEX trip_members_profile_id_idx ON public.trip_members(profile_id);
CREATE INDEX trip_members_trip_id_idx    ON public.trip_members(trip_id);

-- ─── RLS helper functions ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_trip_member(trip_uuid UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.trip_members
    WHERE trip_id = trip_uuid AND profile_id = auth.uid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_trip_organiser(trip_uuid UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.trip_members
    WHERE trip_id = trip_uuid AND profile_id = auth.uid() AND role = 'organiser'
  );
END;
$$;

-- ─── RLS — trips ──────────────────────────────────────────────────────────────

ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Organisers: full access"
  ON public.trips FOR ALL
  USING (organiser_id = auth.uid())
  WITH CHECK (organiser_id = auth.uid());

CREATE POLICY "Members: read their trips"
  ON public.trips FOR SELECT
  USING (public.is_trip_member(id));

-- Anyone can read name/status to show trip name on the join page
CREATE POLICY "Anyone: read by invite code"
  ON public.trips FOR SELECT
  USING (true);

-- ─── RLS — trip_members ───────────────────────────────────────────────────────

ALTER TABLE public.trip_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members: view members of shared trips"
  ON public.trip_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.trip_members my
      WHERE my.trip_id = trip_members.trip_id AND my.profile_id = auth.uid()
    )
  );

CREATE POLICY "Organisers: manage members"
  ON public.trip_members FOR ALL
  USING (public.is_trip_organiser(trip_id))
  WITH CHECK (public.is_trip_organiser(trip_id));

CREATE POLICY "Users: join trips"
  ON public.trip_members FOR INSERT
  WITH CHECK (profile_id = auth.uid());

-- ─── Cross-table profiles policy (requires trip_members to exist) ─────────────
-- This was intentionally deferred from 001_profiles.sql.

CREATE POLICY "Trip members can view each other"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.trip_members a
      JOIN public.trip_members b ON a.trip_id = b.trip_id
      WHERE a.profile_id = auth.uid() AND b.profile_id = profiles.id
    )
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- BEGIN: 003_trip_info.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 003: Trip Information Hub
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.trip_accommodations (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id    UUID    NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  address    TEXT,
  check_in   DATE,
  check_out  DATE,
  notes      TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE public.trip_courses (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     UUID    NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  play_date   DATE,
  address     TEXT,
  website_url TEXT,
  tee_time    TIME,
  notes       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE public.trip_itinerary_items (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     UUID    NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  description TEXT,
  item_date   DATE,
  item_time   TIME,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- RLS — all three tables share the same pattern
ALTER TABLE public.trip_accommodations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members: view" ON public.trip_accommodations FOR SELECT USING (public.is_trip_member(trip_id));
CREATE POLICY "Organisers: manage" ON public.trip_accommodations FOR ALL
  USING (public.is_trip_organiser(trip_id)) WITH CHECK (public.is_trip_organiser(trip_id));

ALTER TABLE public.trip_courses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members: view" ON public.trip_courses FOR SELECT USING (public.is_trip_member(trip_id));
CREATE POLICY "Organisers: manage" ON public.trip_courses FOR ALL
  USING (public.is_trip_organiser(trip_id)) WITH CHECK (public.is_trip_organiser(trip_id));

ALTER TABLE public.trip_itinerary_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members: view" ON public.trip_itinerary_items FOR SELECT USING (public.is_trip_member(trip_id));
CREATE POLICY "Organisers: manage" ON public.trip_itinerary_items FOR ALL
  USING (public.is_trip_organiser(trip_id)) WITH CHECK (public.is_trip_organiser(trip_id));


-- ─────────────────────────────────────────────────────────────────────────────
-- BEGIN: 004_scoring.sql
-- ─────────────────────────────────────────────────────────────────────────────

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


-- ─────────────────────────────────────────────────────────────────────────────
-- BEGIN: 005_side_comps.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 005: Side Competitions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.side_comps (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     UUID    NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  round_id    UUID    REFERENCES public.rounds(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  comp_type   TEXT    NOT NULL CHECK (comp_type IN ('nearest_pin','longest_drive','best_on_day','custom')),
  hole_number INTEGER CHECK (hole_number BETWEEN 1 AND 18),
  description TEXT
);

CREATE TABLE public.side_comp_results (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  side_comp_id UUID        NOT NULL REFERENCES public.side_comps(id) ON DELETE CASCADE,
  player_id    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  result_value TEXT,
  notes        TEXT,
  awarded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  awarded_by   UUID        NOT NULL REFERENCES public.profiles(id)
);

ALTER TABLE public.side_comps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members: view" ON public.side_comps FOR SELECT USING (public.is_trip_member(trip_id));
CREATE POLICY "Organisers: manage" ON public.side_comps FOR ALL
  USING (public.is_trip_organiser(trip_id)) WITH CHECK (public.is_trip_organiser(trip_id));

ALTER TABLE public.side_comp_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members: view" ON public.side_comp_results FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.side_comps sc WHERE sc.id = side_comp_results.side_comp_id AND public.is_trip_member(sc.trip_id)));
CREATE POLICY "Organisers: manage" ON public.side_comp_results FOR ALL
  USING (EXISTS (SELECT 1 FROM public.side_comps sc WHERE sc.id = side_comp_results.side_comp_id AND public.is_trip_organiser(sc.trip_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.side_comps sc WHERE sc.id = side_comp_results.side_comp_id AND public.is_trip_organiser(sc.trip_id)));


-- ─────────────────────────────────────────────────────────────────────────────
-- BEGIN: 006_photos_memory_leaderboard.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 006: Photos, Memory Pack & Leaderboard View
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.trip_photos (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      UUID        NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  uploaded_by  UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  storage_path TEXT        NOT NULL,
  caption      TEXT,
  taken_at     TIMESTAMPTZ,
  is_selected  BOOLEAN     NOT NULL DEFAULT false,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.memory_packs (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id            UUID        UNIQUE NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  winner_id          UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  winner_graphic_url TEXT,
  collage_url        TEXT,
  summary_url        TEXT,
  share_card_url     TEXT,
  generated_at       TIMESTAMPTZ,
  generated_by       UUID        REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.trip_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members: view" ON public.trip_photos FOR SELECT USING (public.is_trip_member(trip_id));
CREATE POLICY "Members: upload" ON public.trip_photos FOR INSERT WITH CHECK (uploaded_by = auth.uid() AND public.is_trip_member(trip_id));
CREATE POLICY "Own: delete" ON public.trip_photos FOR DELETE USING (uploaded_by = auth.uid());
CREATE POLICY "Organisers: manage all" ON public.trip_photos FOR ALL USING (public.is_trip_organiser(trip_id));

ALTER TABLE public.memory_packs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members: view" ON public.memory_packs FOR SELECT USING (public.is_trip_member(trip_id));
CREATE POLICY "Organisers: manage" ON public.memory_packs FOR ALL
  USING (public.is_trip_organiser(trip_id)) WITH CHECK (public.is_trip_organiser(trip_id));

-- ─── Leaderboard view ─────────────────────────────────────────────────────────
-- Computed in Postgres — consistent across all clients.
-- React Query subscribes to Realtime on score_entries then re-queries this view.

CREATE OR REPLACE VIEW public.leaderboard_view AS
SELECT
  r.id                                             AS round_id,
  r.trip_id,
  sc.player_id,
  p.full_name,
  sc.playing_handicap,
  COALESCE(SUM(se.stableford_pts), 0)::INTEGER     AS total_stableford_pts,
  COUNT(se.id)::INTEGER                            AS holes_played,
  RANK() OVER (
    PARTITION BY r.id
    ORDER BY COALESCE(SUM(se.stableford_pts), 0) DESC
  )::INTEGER                                       AS rank
FROM public.rounds r
JOIN public.scorecards sc ON sc.round_id = r.id
JOIN public.profiles p    ON p.id = sc.player_id
LEFT JOIN public.score_entries se ON se.scorecard_id = sc.id
WHERE sc.status != 'withdrawn'
GROUP BY r.id, r.trip_id, sc.player_id, p.full_name, sc.playing_handicap;

-- Storage buckets — create these in the Supabase dashboard or via CLI:
--   supabase storage create trip-assets --public
--   supabase storage create trip-photos --public

