-- ─────────────────────────────────────────────────────────────────────────────
-- 002: Trips & Trip Members
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

-- RLS helpers
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

-- RLS — trips
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Organisers: full access"
  ON public.trips FOR ALL
  USING (organiser_id = auth.uid())
  WITH CHECK (organiser_id = auth.uid());

CREATE POLICY "Members: read their trips"
  ON public.trips FOR SELECT
  USING (public.is_trip_member(id));

-- Anyone can read name/status for invite lookup (join page)
CREATE POLICY "Anyone: read by invite code"
  ON public.trips FOR SELECT
  USING (true);

-- RLS — trip_members
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
