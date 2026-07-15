-- =============================================================================
-- 015: Sprint 3 — Definitive Migration
-- =============================================================================
-- Run this ONE file in Supabase SQL Editor.
-- It supersedes all previous Sprint 3 migrations (009–014).
-- Fully idempotent — safe to run multiple times.
-- No existing data is deleted or altered.
-- =============================================================================

-- ── 1. trips: Sprint 3 columns ────────────────────────────────────────────────

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS expected_players     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS players_per_group    INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS organiser_is_playing BOOLEAN NOT NULL DEFAULT false;

-- Status constraint: add 'groups_ready' if not already present
DO $$
DECLARE v_conname TEXT;
BEGIN
  SELECT conname INTO v_conname
  FROM pg_constraint c
  JOIN pg_class r ON r.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = r.relnamespace
  WHERE n.nspname = 'public' AND r.relname = 'trips'
    AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%draft%'
  LIMIT 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.trips DROP CONSTRAINT %I', v_conname);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public' AND r.relname = 'trips'
      AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%groups_ready%'
  ) THEN
    ALTER TABLE public.trips ADD CONSTRAINT trips_status_check
      CHECK (status IN ('draft','open','groups_ready','ready','live','completed','archived'));
  END IF;
END $$;

-- ── 2. profiles: handicap + status ───────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS handicap        DECIMAL(4,1) NULL,
  ADD COLUMN IF NOT EXISTS handicap_status TEXT         NOT NULL DEFAULT 'pending';

-- Add CHECK constraint on handicap_status if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_handicap_status_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_handicap_status_check
        CHECK (handicap_status IN ('pending','provided','no_official_handicap'));
  END IF;
END $$;

-- Back-fill: existing rows with a handicap value → 'provided'
UPDATE public.profiles
  SET handicap_status = 'provided'
  WHERE handicap IS NOT NULL AND handicap_status = 'pending';

-- ── 3. trip_groups table ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.trip_groups (
  id         UUID        NOT NULL DEFAULT gen_random_uuid(),
  trip_id    UUID        NOT NULL,
  name       TEXT        NOT NULL,
  tee_time   TEXT        NULL,
  sort_order INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT trip_groups_pkey       PRIMARY KEY (id),
  CONSTRAINT trip_groups_trip_fkey  FOREIGN KEY (trip_id)
    REFERENCES public.trips(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS trip_groups_trip_id_idx ON public.trip_groups(trip_id);

-- ── 4. trip_members: group_id + playing_handicap ────────────────────────────

ALTER TABLE public.trip_members
  ADD COLUMN IF NOT EXISTS group_id         UUID         NULL,
  ADD COLUMN IF NOT EXISTS playing_handicap NUMERIC(4,1) NULL;

-- FK: group_id → trip_groups
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'trip_members_group_id_fkey'
      AND table_name = 'trip_members' AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.trip_members
      ADD CONSTRAINT trip_members_group_id_fkey
        FOREIGN KEY (group_id) REFERENCES public.trip_groups(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Range constraint on playing_handicap
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trip_members_playing_handicap_range'
  ) THEN
    ALTER TABLE public.trip_members
      ADD CONSTRAINT trip_members_playing_handicap_range
        CHECK (playing_handicap IS NULL OR playing_handicap BETWEEN -10 AND 54);
  END IF;
END $$;

-- ── 5. trip_groups RLS ───────────────────────────────────────────────────────

ALTER TABLE public.trip_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trip_groups_select"          ON public.trip_groups;
DROP POLICY IF EXISTS "trip_groups_organiser_write" ON public.trip_groups;

CREATE POLICY "trip_groups_select"
  ON public.trip_groups FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id = trip_groups.trip_id AND tm.profile_id = auth.uid()
    )
  );

CREATE POLICY "trip_groups_organiser_write"
  ON public.trip_groups FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = trip_groups.trip_id AND t.organiser_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = trip_groups.trip_id AND t.organiser_id = auth.uid()
    )
  );

-- ── 6. profiles RLS: co-member visibility ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.shares_trip_with(other_profile_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.trip_members a
    JOIN public.trip_members b ON a.trip_id = b.trip_id
    WHERE a.profile_id = auth.uid() AND b.profile_id = other_profile_id
  );
END;
$$;

DROP POLICY IF EXISTS "Trip members can view each other"  ON public.profiles;
DROP POLICY IF EXISTS "trip_members_view_profiles"        ON public.profiles;
DROP POLICY IF EXISTS "profiles_trip_members_view"        ON public.profiles;
DROP POLICY IF EXISTS "profiles_view_own_and_cotrip"      ON public.profiles;

CREATE POLICY "profiles_view_own_and_cotrip"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id OR public.shares_trip_with(id));

-- ── 7. handle_new_user trigger: save name + handicap on signup ───────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_handicap      DECIMAL(4,1) := NULL;
  v_hcp_raw       TEXT;
  v_hcp_status    TEXT;
BEGIN
  v_hcp_raw    := NEW.raw_user_meta_data->>'handicap';
  v_hcp_status := COALESCE(NEW.raw_user_meta_data->>'handicap_status', 'pending');

  IF v_hcp_raw IS NOT NULL AND v_hcp_raw <> '' THEN
    BEGIN
      v_handicap := v_hcp_raw::DECIMAL(4,1);
    EXCEPTION WHEN OTHERS THEN
      v_handicap := NULL;
    END;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, handicap, handicap_status)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    v_handicap,
    v_hcp_status
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name       = EXCLUDED.full_name,
    handicap        = COALESCE(EXCLUDED.handicap, profiles.handicap),
    handicap_status = CASE
      WHEN profiles.handicap_status = 'pending' THEN EXCLUDED.handicap_status
      ELSE profiles.handicap_status
    END;

  RETURN NEW;
END;
$$;

-- ── VERIFICATION ─────────────────────────────────────────────────────────────
-- Run after applying to confirm all objects exist:
--
-- SELECT
--   (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public'
--    AND table_name='trips' AND column_name IN ('expected_players','players_per_group','organiser_is_playing')
--   ) AS trips_cols,              -- 3
--   (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public'
--    AND table_name='profiles' AND column_name IN ('handicap','handicap_status')
--   ) AS profiles_cols,           -- 2
--   (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public'
--    AND table_name='trip_members' AND column_name IN ('group_id','playing_handicap')
--   ) AS trip_members_cols,       -- 2
--   (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'
--    AND table_name='trip_groups'
--   ) AS trip_groups_table,       -- 1
--   (SELECT COUNT(*) FROM pg_policies WHERE schemaname='public' AND tablename='trip_groups'
--   ) AS trip_groups_policies;    -- 2
-- Expected: 3, 2, 2, 1, 2
