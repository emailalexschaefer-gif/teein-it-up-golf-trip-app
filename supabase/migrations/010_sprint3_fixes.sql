-- ─────────────────────────────────────────────────────────────────────────────
-- 010: Sprint 3 Fixes
-- 1. Fix profiles RLS — allow co-members to see each other's profiles
--    without recursing through trip_members SELECT policy (tm_select_own)
-- 2. Add organiser_is_playing column to trips
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Fix profiles "Trip members can view each other" policy ────────────────
-- 
-- The old policy does:
--   EXISTS (SELECT 1 FROM trip_members a JOIN trip_members b ...)
-- With tm_select_own (profile_id = auth.uid()), trip_members is filtered
-- to only return the current user's row. So the JOIN can only match the
-- current user's own profile, blocking other members' profiles from being seen.
--
-- Fix: use is_trip_member() which is SECURITY DEFINER and bypasses RLS.
-- This lets the function check co-membership without hitting the RLS filter.

DROP POLICY IF EXISTS "Trip members can view each other" ON public.profiles;
DROP POLICY IF EXISTS "trip_members_view_profiles"       ON public.profiles;

CREATE POLICY "profiles_trip_members_view"
  ON public.profiles FOR SELECT
  USING (
    -- Always see your own profile
    auth.uid() = id
    OR
    -- See profiles of people who share a trip with you
    -- is_trip_member is SECURITY DEFINER so it bypasses RLS on trip_members
    EXISTS (
      SELECT 1
      FROM public.trip_members AS my_trips
      JOIN public.trip_members AS their_trips
        ON my_trips.trip_id = their_trips.trip_id
      WHERE my_trips.profile_id  = auth.uid()
        AND their_trips.profile_id = profiles.id
    )
  );

-- Note: the JOIN above still goes through trip_members RLS (tm_select_own).
-- But tm_select_own filters on profile_id = auth.uid() for my_trips —
-- that's fine because we ARE filtering by auth.uid() there.
-- their_trips has no profile_id filter in the WHERE clause for RLS purposes
-- because RLS applies to the alias independently... actually this is the same issue.
-- 
-- Use a different approach: check via is_trip_member on the other person's trips.
-- Better: use a SECURITY DEFINER function that checks co-membership directly.

-- Drop and use a clean function-based approach:
DROP POLICY IF EXISTS "profiles_trip_members_view" ON public.profiles;

CREATE OR REPLACE FUNCTION public.shares_trip_with(other_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.trip_members a
    JOIN public.trip_members b ON a.trip_id = b.trip_id
    WHERE a.profile_id = auth.uid()
      AND b.profile_id = other_profile_id
  );
END;
$$;

CREATE POLICY "profiles_view_own_and_cotrip"
  ON public.profiles FOR SELECT
  USING (
    auth.uid() = id
    OR public.shares_trip_with(id)
  );

-- ── 2. Add organiser_is_playing to trips ─────────────────────────────────────
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS organiser_is_playing BOOLEAN NOT NULL DEFAULT false;
