-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION 008: Fix trip_members RLS infinite recursion
-- 
-- The original policy "Members: view members of shared trips" uses a self-join
-- on trip_members that can cause RLS infinite recursion issues in PostgreSQL.
-- This migration replaces it with a SECURITY DEFINER function call,
-- which bypasses the recursion by running the check outside RLS context.
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop the problematic self-referential policy
DROP POLICY IF EXISTS "Members: view members of shared trips" ON public.trip_members;

-- Replace with a policy using the SECURITY DEFINER helper (no recursion)
-- is_trip_member() is defined in 002_trips.sql as SECURITY DEFINER
CREATE POLICY "Members: view members of shared trips"
  ON public.trip_members FOR SELECT
  USING (public.is_trip_member(trip_id));
