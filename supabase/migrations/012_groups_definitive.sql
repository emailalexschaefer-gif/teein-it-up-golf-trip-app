-- =============================================================================
-- 012: Groups — Definitive Migration
-- Run this in Supabase SQL Editor if groups are not working.
-- Every statement is idempotent. No existing data is affected.
-- =============================================================================

-- ── STEP 1: Add new columns to trips (safe if already exist) ─────────────────

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS expected_players     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS players_per_group    INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS organiser_is_playing BOOLEAN NOT NULL DEFAULT false;

-- ── STEP 2: Expand status CHECK constraint ────────────────────────────────────
-- Drop old constraint and recreate with 'groups_ready' included.
-- The DO block checks first so we only touch it if needed.

DO $$
BEGIN
  -- Drop any existing status constraint (handles different names)
  ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_status_check;
  ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_status_check1;
  -- Add the full constraint
  ALTER TABLE public.trips ADD CONSTRAINT trips_status_check
    CHECK (status IN ('draft','open','groups_ready','ready','live','completed','archived'));
END $$;

-- ── STEP 3: Create trip_groups table ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.trip_groups (
  id         UUID        NOT NULL DEFAULT gen_random_uuid(),
  trip_id    UUID        NOT NULL,
  name       TEXT        NOT NULL,
  tee_time   TEXT        NULL,
  sort_order INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT trip_groups_pkey PRIMARY KEY (id),
  CONSTRAINT trip_groups_trip_id_fkey
    FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS trip_groups_trip_id_idx ON public.trip_groups(trip_id);

-- ── STEP 4: Add group_id to trip_members ─────────────────────────────────────
-- Must run AFTER step 3 so the FK target exists.

ALTER TABLE public.trip_members
  ADD COLUMN IF NOT EXISTS group_id UUID NULL;

-- Add FK constraint only if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'trip_members_group_id_fkey'
      AND table_name = 'trip_members'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.trip_members
      ADD CONSTRAINT trip_members_group_id_fkey
        FOREIGN KEY (group_id) REFERENCES public.trip_groups(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── STEP 5: Enable RLS on trip_groups ────────────────────────────────────────

ALTER TABLE public.trip_groups ENABLE ROW LEVEL SECURITY;

-- Drop and recreate policies (idempotent)
DROP POLICY IF EXISTS "trip_groups_select"          ON public.trip_groups;
DROP POLICY IF EXISTS "trip_groups_organiser_write" ON public.trip_groups;
DROP POLICY IF EXISTS "trip_groups_all"             ON public.trip_groups;

-- Any trip member can read groups for their trip
CREATE POLICY "trip_groups_select"
  ON public.trip_groups
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id    = trip_groups.trip_id
        AND tm.profile_id = auth.uid()
    )
  );

-- Only the trip organiser can insert / update / delete groups
CREATE POLICY "trip_groups_organiser_write"
  ON public.trip_groups
  FOR ALL
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

-- ── STEP 6: SECURITY DEFINER function for profile co-visibility ──────────────

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

-- ── STEP 7: Fix profiles RLS for co-member visibility ────────────────────────

DROP POLICY IF EXISTS "Trip members can view each other"  ON public.profiles;
DROP POLICY IF EXISTS "trip_members_view_profiles"        ON public.profiles;
DROP POLICY IF EXISTS "profiles_trip_members_view"        ON public.profiles;
DROP POLICY IF EXISTS "profiles_view_own_and_cotrip"      ON public.profiles;

CREATE POLICY "profiles_view_own_and_cotrip"
  ON public.profiles
  FOR SELECT
  USING (
    auth.uid() = id
    OR public.shares_trip_with(id)
  );

-- ── STEP 8: Verify ───────────────────────────────────────────────────────────
-- Run this SELECT after to confirm success (should return 3, 1, 1, 2):

-- SELECT
--   (SELECT COUNT(*) FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='trips'
--    AND column_name IN ('expected_players','players_per_group','organiser_is_playing')
--   ) AS trips_cols,          -- expect 3
--   (SELECT COUNT(*) FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='trip_members'
--    AND column_name='group_id'
--   ) AS group_id_col,        -- expect 1
--   (SELECT COUNT(*) FROM information_schema.tables
--    WHERE table_schema='public' AND table_name='trip_groups'
--   ) AS trip_groups_table,   -- expect 1
--   (SELECT COUNT(*) FROM pg_policies
--    WHERE schemaname='public' AND tablename='trip_groups'
--   ) AS trip_groups_policies; -- expect 2
