-- ─────────────────────────────────────────────────────────────────────────────
-- 011: Sprint 3 — Apply all schema changes safely
--
-- This migration is idempotent. Run it regardless of whether 009/010 were
-- applied. Every statement uses IF NOT EXISTS or OR REPLACE so existing
-- data is never touched.
--
-- Covers:
--   • trips: expected_players, players_per_group, organiser_is_playing
--   • trips: status check constraint updated to include 'groups_ready'
--   • trip_groups table + RLS
--   • trip_members: group_id column
--   • profiles RLS: SECURITY DEFINER function for co-member visibility
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. trips — player capacity columns ───────────────────────────────────────
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS expected_players     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS players_per_group    INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS organiser_is_playing BOOLEAN NOT NULL DEFAULT false;

-- ── 2. trips — status check constraint ───────────────────────────────────────
-- Drop the old constraint (if it doesn't already include groups_ready) and
-- recreate it with the full Sprint 3 status set.
ALTER TABLE public.trips
  DROP CONSTRAINT IF EXISTS trips_status_check;

ALTER TABLE public.trips
  ADD CONSTRAINT trips_status_check
  CHECK (status IN (
    'draft', 'open', 'groups_ready', 'ready', 'live', 'completed', 'archived'
  ));

-- ── 3. trip_groups table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trip_groups (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id    UUID        NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  tee_time   TEXT,
  sort_order INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trip_groups_trip_id_idx
  ON public.trip_groups(trip_id);

-- ── 4. trip_members — group_id column ────────────────────────────────────────
-- Add AFTER the trip_groups table so the FK reference exists.
ALTER TABLE public.trip_members
  ADD COLUMN IF NOT EXISTS group_id UUID
    REFERENCES public.trip_groups(id) ON DELETE SET NULL;

-- ── 5. trip_groups RLS ───────────────────────────────────────────────────────
ALTER TABLE public.trip_groups ENABLE ROW LEVEL SECURITY;

-- Drop before recreating so re-runs are safe
DROP POLICY IF EXISTS "trip_groups_select"         ON public.trip_groups;
DROP POLICY IF EXISTS "trip_groups_organiser_write" ON public.trip_groups;

-- Members can read groups for trips they belong to
-- (trip_members SELECT is handled by tm_select_own — only own row visible,
--  but that's enough to prove membership)
CREATE POLICY "trip_groups_select"
  ON public.trip_groups FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id    = trip_groups.trip_id
        AND tm.profile_id = auth.uid()
    )
  );

-- Only the organiser can create / update / delete groups
CREATE POLICY "trip_groups_organiser_write"
  ON public.trip_groups FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id           = trip_groups.trip_id
        AND t.organiser_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id           = trip_groups.trip_id
        AND t.organiser_id = auth.uid()
    )
  );

-- ── 6. Profiles RLS — co-member visibility ───────────────────────────────────
-- The old "Trip members can view each other" policy queries trip_members
-- inside a JOIN, which is blocked by tm_select_own (profile_id = auth.uid()).
-- Replace with a SECURITY DEFINER function that bypasses RLS internally.

DROP POLICY IF EXISTS "Trip members can view each other" ON public.profiles;
DROP POLICY IF EXISTS "trip_members_view_profiles"       ON public.profiles;
DROP POLICY IF EXISTS "profiles_trip_members_view"       ON public.profiles;
DROP POLICY IF EXISTS "profiles_view_own_and_cotrip"     ON public.profiles;

-- SECURITY DEFINER function: checks co-membership without RLS interference
CREATE OR REPLACE FUNCTION public.shares_trip_with(other_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM   public.trip_members a
    JOIN   public.trip_members b ON a.trip_id = b.trip_id
    WHERE  a.profile_id = auth.uid()
      AND  b.profile_id = other_profile_id
  );
END;
$$;

-- Profiles: see own profile + anyone who shares a trip
CREATE POLICY "profiles_view_own_and_cotrip"
  ON public.profiles FOR SELECT
  USING (
    auth.uid() = id
    OR public.shares_trip_with(id)
  );

-- ── 7. Verification query (returns counts, not modifies anything) ─────────────
-- Run this after applying the migration to confirm everything is in place:
--
--   SELECT
--     (SELECT COUNT(*) FROM information_schema.columns
--      WHERE table_schema = 'public' AND table_name = 'trips'
--        AND column_name IN ('expected_players','players_per_group','organiser_is_playing')
--     ) AS trips_new_cols,           -- should be 3
--     (SELECT COUNT(*) FROM information_schema.columns
--      WHERE table_schema = 'public' AND table_name = 'trip_members'
--        AND column_name = 'group_id'
--     ) AS trip_members_group_id,    -- should be 1
--     (SELECT COUNT(*) FROM information_schema.tables
--      WHERE table_schema = 'public' AND table_name = 'trip_groups'
--     ) AS trip_groups_table,        -- should be 1
--     (SELECT COUNT(*) FROM pg_policies
--      WHERE schemaname = 'public' AND tablename = 'trip_groups'
--     ) AS trip_groups_policies;     -- should be 2
