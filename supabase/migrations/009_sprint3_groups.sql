-- ─────────────────────────────────────────────────────────────────────────────
-- 008: Sprint 3 — Groups, Tee Times, Player Capacity
-- Run after migrations 001–007.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Add player capacity fields to trips ───────────────────────────────────
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS expected_players  INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS players_per_group INTEGER DEFAULT 4;

-- ── 2. Groups table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trip_groups (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     UUID        NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  tee_time    TEXT,                  -- 'HH:MM' format
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trip_groups_trip_id_idx ON public.trip_groups(trip_id);

-- ── 3. Add group assignment to trip_members ───────────────────────────────────
ALTER TABLE public.trip_members
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.trip_groups(id) ON DELETE SET NULL;

-- ── 4. Update status labels — add 'groups_ready' stage ───────────────────────
-- The trips.status CHECK constraint needs updating.
-- We add the new status value.
ALTER TABLE public.trips
  DROP CONSTRAINT IF EXISTS trips_status_check;

ALTER TABLE public.trips
  ADD CONSTRAINT trips_status_check
  CHECK (status IN ('draft','open','groups_ready','ready','live','completed','archived'));

-- ── 5. RLS for trip_groups ────────────────────────────────────────────────────
ALTER TABLE public.trip_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trip_groups_select"
  ON public.trip_groups FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id = trip_groups.trip_id
        AND tm.profile_id = auth.uid()
    )
  );

CREATE POLICY "trip_groups_organiser_write"
  ON public.trip_groups FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = trip_groups.trip_id
        AND t.organiser_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = trip_groups.trip_id
        AND t.organiser_id = auth.uid()
    )
  );
