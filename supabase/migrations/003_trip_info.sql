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
