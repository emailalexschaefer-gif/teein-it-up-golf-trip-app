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
