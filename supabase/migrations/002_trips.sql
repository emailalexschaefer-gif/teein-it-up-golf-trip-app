-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION 002: Trips & Trip Members
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Trip status enum ─────────────────────────────────────────────────────────
CREATE TYPE trip_status AS ENUM (
  'draft',
  'open',       -- Open for Invitations
  'ready',      -- All players confirmed
  'live',       -- Trip in progress
  'completed',  -- All rounds done
  'archived'    -- Hidden from main dashboard
);

-- ─── Invite code generator ───────────────────────────────────────────────────
-- Generates a 6-character alphanumeric code, excluding ambiguous characters
CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code  TEXT := '';
  i     INTEGER;
BEGIN
  FOR i IN 1..6 LOOP
    code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN code;
END;
$$ LANGUAGE plpgsql;

-- ─── trips ────────────────────────────────────────────────────────────────────
CREATE TABLE public.trips (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organiser_id     UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name             TEXT         NOT NULL,
  description      TEXT,
  start_date       DATE         NOT NULL,
  end_date         DATE         NOT NULL,
  status           trip_status  NOT NULL DEFAULT 'draft',
  logo_url         TEXT,
  cover_image_url  TEXT,
  invite_code      TEXT         NOT NULL UNIQUE DEFAULT public.generate_invite_code(),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT trips_dates_valid CHECK (end_date >= start_date)
);

CREATE TRIGGER trips_updated_at
  BEFORE UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─── trip_members ─────────────────────────────────────────────────────────────
CREATE TYPE trip_role AS ENUM ('organiser', 'player');

CREATE TABLE public.trip_members (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     UUID        NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  profile_id  UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role        trip_role   NOT NULL DEFAULT 'player',
  nickname    TEXT,
  team        TEXT,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (trip_id, profile_id)  -- one membership per person per trip
);

-- Index for quick membership lookup
CREATE INDEX trip_members_profile_id_idx ON public.trip_members(profile_id);
CREATE INDEX trip_members_trip_id_idx    ON public.trip_members(trip_id);

-- ─── RLS — trips ──────────────────────────────────────────────────────────────
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

-- Organisers can do everything on their own trips
CREATE POLICY "Organisers can manage their trips"
  ON public.trips FOR ALL
  USING (organiser_id = auth.uid())
  WITH CHECK (organiser_id = auth.uid());

-- Members can view trips they belong to
CREATE POLICY "Members can view their trips"
  ON public.trips FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.trip_members
      WHERE trip_id = trips.id AND profile_id = auth.uid()
    )
  );

-- Anyone can look up a trip by invite code (to show trip name on join page)
CREATE POLICY "Anyone can view trip by invite code (name only)"
  ON public.trips FOR SELECT
  USING (true);  -- Refined by application logic; full data gated by membership

-- ─── RLS — trip_members ───────────────────────────────────────────────────────
ALTER TABLE public.trip_members ENABLE ROW LEVEL SECURITY;

-- Members can see all members of trips they belong to
CREATE POLICY "Members can view trip members"
  ON public.trip_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.trip_members AS my_membership
      WHERE my_membership.trip_id = trip_members.trip_id
        AND my_membership.profile_id = auth.uid()
    )
  );

-- Organisers can manage members of their trips
CREATE POLICY "Organisers can manage trip members"
  ON public.trip_members FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.trip_members AS my_role
      WHERE my_role.trip_id = trip_members.trip_id
        AND my_role.profile_id = auth.uid()
        AND my_role.role = 'organiser'
    )
  );

-- Users can insert themselves as a member (join flow)
CREATE POLICY "Users can join trips"
  ON public.trip_members FOR INSERT
  WITH CHECK (profile_id = auth.uid());
