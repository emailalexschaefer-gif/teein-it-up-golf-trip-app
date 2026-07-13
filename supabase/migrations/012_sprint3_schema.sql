-- =============================================================================
-- Sprint 3 — Complete Schema Migration
-- File: 012_sprint3_schema.sql
--
-- Covers everything needed for Sprint 3 to function:
--   • trips: expected_players, players_per_group, organiser_is_playing
--   • trips: status constraint updated to include 'groups_ready'
--   • profiles: handicap (default handicap)
--   • trip_members: group_id, playing_handicap
--   • trip_groups: table, indexes, RLS, organiser permissions
--   • profiles RLS: SECURITY DEFINER function for co-member visibility
--
-- Safe to run on any Sprint 1/2 database.
-- Idempotent — every statement uses IF NOT EXISTS, IF EXISTS, or OR REPLACE.
-- No existing data is deleted or altered.
-- =============================================================================

-- ── STEP 1: trips — capacity and organiser-playing columns ───────────────────

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS expected_players     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS players_per_group    INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS organiser_is_playing BOOLEAN NOT NULL DEFAULT false;

-- ── STEP 2: trips — status constraint (add 'groups_ready') ──────────────────
-- Finds any existing check constraint on the status column and replaces it.

DO $$
DECLARE
  v_conname TEXT;
BEGIN
  -- Find the current status check constraint by content
  SELECT conname INTO v_conname
  FROM   pg_constraint c
  JOIN   pg_class r ON r.oid = c.conrelid
  JOIN   pg_namespace n ON n.oid = r.relnamespace
  WHERE  n.nspname = 'public'
    AND  r.relname = 'trips'
    AND  c.contype = 'c'
    AND  pg_get_constraintdef(c.oid) LIKE '%draft%'
  LIMIT 1;

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.trips DROP CONSTRAINT %I', v_conname);
  END IF;

  -- Only add the new constraint if it doesn't already include groups_ready
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public' AND r.relname = 'trips'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%groups_ready%'
  ) THEN
    ALTER TABLE public.trips ADD CONSTRAINT trips_status_check
      CHECK (status IN (
        'draft','open','groups_ready','ready','live','completed','archived'
      ));
  END IF;
END $$;

-- ── STEP 3: profiles — default handicap ──────────────────────────────────────
-- profiles.handicap should already exist from 001_profiles.sql
-- This adds it if it doesn't for any reason.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS handicap DECIMAL(4,1) NULL;

-- ── STEP 4: trip_groups table ────────────────────────────────────────────────

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

CREATE INDEX IF NOT EXISTS trip_groups_trip_id_idx
  ON public.trip_groups(trip_id);

-- ── STEP 5: trip_members — group_id and playing_handicap ────────────────────
-- group_id must be added AFTER trip_groups table exists.

ALTER TABLE public.trip_members
  ADD COLUMN IF NOT EXISTS group_id         UUID         NULL,
  ADD COLUMN IF NOT EXISTS playing_handicap DECIMAL(4,1) NULL;

-- Add FK constraint only if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE  constraint_name = 'trip_members_group_id_fkey'
      AND  table_name      = 'trip_members'
      AND  table_schema    = 'public'
  ) THEN
    ALTER TABLE public.trip_members
      ADD CONSTRAINT trip_members_group_id_fkey
        FOREIGN KEY (group_id)
        REFERENCES public.trip_groups(id)
        ON DELETE SET NULL;
  END IF;
END $$;

-- ── STEP 6: RLS on trip_groups ───────────────────────────────────────────────

ALTER TABLE public.trip_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trip_groups_select"          ON public.trip_groups;
DROP POLICY IF EXISTS "trip_groups_organiser_write" ON public.trip_groups;
DROP POLICY IF EXISTS "trip_groups_all"             ON public.trip_groups;

-- Any trip member may read groups for their trip
CREATE POLICY "trip_groups_select"
  ON public.trip_groups FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE  tm.trip_id    = trip_groups.trip_id
        AND  tm.profile_id = auth.uid()
    )
  );

-- Only the trip organiser may create, update, or delete groups
CREATE POLICY "trip_groups_organiser_write"
  ON public.trip_groups FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE  t.id           = trip_groups.trip_id
        AND  t.organiser_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE  t.id           = trip_groups.trip_id
        AND  t.organiser_id = auth.uid()
    )
  );

-- ── STEP 7: profiles RLS — co-member visibility ──────────────────────────────
-- Replace the recursive self-join policy with a SECURITY DEFINER function.

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

DROP POLICY IF EXISTS "Trip members can view each other"  ON public.profiles;
DROP POLICY IF EXISTS "trip_members_view_profiles"        ON public.profiles;
DROP POLICY IF EXISTS "profiles_trip_members_view"        ON public.profiles;
DROP POLICY IF EXISTS "profiles_view_own_and_cotrip"      ON public.profiles;

CREATE POLICY "profiles_view_own_and_cotrip"
  ON public.profiles FOR SELECT
  USING (
    auth.uid() = id
    OR public.shares_trip_with(id)
  );

-- =============================================================================
-- VERIFICATION
-- Run this SELECT after applying the migration.
-- Every value must match the number in the comment.
--
-- SELECT
--   (SELECT COUNT(*) FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='trips'
--    AND column_name IN ('expected_players','players_per_group','organiser_is_playing')
--   ) AS trips_cols,              -- 3
--   (SELECT COUNT(*) FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='profiles'
--    AND column_name='handicap'
--   ) AS profiles_handicap,       -- 1
--   (SELECT COUNT(*) FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='trip_members'
--    AND column_name IN ('group_id','playing_handicap')
--   ) AS tm_cols,                 -- 2
--   (SELECT COUNT(*) FROM information_schema.tables
--    WHERE table_schema='public' AND table_name='trip_groups'
--   ) AS trip_groups_table,       -- 1
--   (SELECT COUNT(*) FROM pg_policies
--    WHERE schemaname='public' AND tablename='trip_groups'
--   ) AS trip_groups_policies;    -- 2
-- =============================================================================

-- ── STEP 8: Update profile trigger to capture handicap on sign-up ─────────────
-- When a user signs up via supabase.auth.signUp({ options: { data: { handicap } } }),
-- the value lands in raw_user_meta_data. This trigger now reads it into profiles.handicap
-- so it's saved even when email confirmation is required.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_handicap DECIMAL(4,1) := NULL;
  v_hcp_raw  TEXT;
BEGIN
  -- Pull handicap from signup metadata if provided and non-empty
  v_hcp_raw := NEW.raw_user_meta_data->>'handicap';
  IF v_hcp_raw IS NOT NULL AND v_hcp_raw <> '' THEN
    BEGIN
      v_handicap := v_hcp_raw::DECIMAL(4,1);
    EXCEPTION WHEN OTHERS THEN
      v_handicap := NULL;  -- ignore malformed values
    END;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, handicap)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    v_handicap
  )
  ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        handicap  = COALESCE(EXCLUDED.handicap, profiles.handicap);

  RETURN NEW;
END;
$$;
-- Trigger already exists from 001_profiles.sql — no need to recreate it.
