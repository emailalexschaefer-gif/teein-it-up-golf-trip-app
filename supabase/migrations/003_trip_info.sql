-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION 003: Trip Information Hub
-- Accommodation, courses, and itinerary.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── trip_accommodations ──────────────────────────────────────────────────────
CREATE TABLE public.trip_accommodations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     UUID        NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  address     TEXT,
  check_in    DATE,
  check_out   DATE,
  notes       TEXT,
  sort_order  INTEGER     NOT NULL DEFAULT 0
);

CREATE INDEX trip_accommodations_trip_id_idx ON public.trip_accommodations(trip_id);

-- ─── trip_courses ─────────────────────────────────────────────────────────────
CREATE TABLE public.trip_courses (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     UUID        NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  play_date   DATE,
  address     TEXT,
  website_url TEXT,
  tee_time    TIME,
  notes       TEXT,
  sort_order  INTEGER     NOT NULL DEFAULT 0
);

CREATE INDEX trip_courses_trip_id_idx ON public.trip_courses(trip_id);

-- ─── trip_itinerary_items ─────────────────────────────────────────────────────
CREATE TABLE public.trip_itinerary_items (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     UUID        NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL,
  description TEXT,
  item_date   DATE,
  item_time   TIME,
  sort_order  INTEGER     NOT NULL DEFAULT 0
);

CREATE INDEX trip_itinerary_trip_id_idx ON public.trip_itinerary_items(trip_id);

-- ─── RLS — information hub tables ─────────────────────────────────────────────
-- Pattern: members can SELECT, organisers can ALL

-- Helper function to check trip membership
CREATE OR REPLACE FUNCTION public.is_trip_member(trip_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.trip_members
    WHERE trip_id = trip_uuid AND profile_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to check organiser role
CREATE OR REPLACE FUNCTION public.is_trip_organiser(trip_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.trip_members
    WHERE trip_id = trip_uuid
      AND profile_id = auth.uid()
      AND role = 'organiser'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Accommodations
ALTER TABLE public.trip_accommodations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view accommodations"
  ON public.trip_accommodations FOR SELECT
  USING (public.is_trip_member(trip_id));
CREATE POLICY "Organisers can manage accommodations"
  ON public.trip_accommodations FOR ALL
  USING (public.is_trip_organiser(trip_id))
  WITH CHECK (public.is_trip_organiser(trip_id));

-- Courses
ALTER TABLE public.trip_courses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view courses"
  ON public.trip_courses FOR SELECT
  USING (public.is_trip_member(trip_id));
CREATE POLICY "Organisers can manage courses"
  ON public.trip_courses FOR ALL
  USING (public.is_trip_organiser(trip_id))
  WITH CHECK (public.is_trip_organiser(trip_id));

-- Itinerary
ALTER TABLE public.trip_itinerary_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view itinerary"
  ON public.trip_itinerary_items FOR SELECT
  USING (public.is_trip_member(trip_id));
CREATE POLICY "Organisers can manage itinerary"
  ON public.trip_itinerary_items FOR ALL
  USING (public.is_trip_organiser(trip_id))
  WITH CHECK (public.is_trip_organiser(trip_id));
