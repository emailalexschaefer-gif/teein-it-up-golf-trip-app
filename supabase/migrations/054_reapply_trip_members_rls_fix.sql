-- =============================================================================
-- 054_reapply_trip_members_rls_fix.sql
-- =============================================================================
-- Bug: a joined player's own trip page showed the correct player COUNT
-- (from a simple flat trip_members query) but an incomplete ROSTER (from
-- page.tsx's more complex query, nesting trip_members through trips and
-- further through profiles) — only the viewing player's own row
-- reliably appeared.
--
-- Leading hypothesis, not confirmed against production directly:
-- migration 008 (2026, "Fix trip_members RLS infinite recursion")
-- replaced a self-referential SELECT policy — one that queried
-- trip_members FROM WITHIN its own trip_members RLS check — with a
-- SECURITY DEFINER function call that avoids the recursion. Given this
-- project's now well-established pattern of migrations existing in the
-- repository without actually having been applied to production (026,
-- 037/038, 024 were all found this way), it's entirely plausible 008
-- never ran. Under the OLD recursive policy, a query complex enough to
-- trigger Postgres's RLS recursion handling could correctly resolve
-- "does a row exist where my own profile_id matches" (trivial, no
-- further recursion needed) while failing to reliably resolve visibility
-- for OTHER members' rows in the same nested query — exactly the
-- reported symptom.
--
-- This migration is purely defensive: DROP POLICY IF EXISTS + CREATE
-- POLICY is fully idempotent. If 008 already applied correctly, this is
-- a harmless no-op recreation of the identical policy. If it didn't,
-- this closes the actual gap at the database layer, not just via an
-- application-level workaround.
-- =============================================================================

DROP POLICY IF EXISTS "Members: view members of shared trips" ON public.trip_members;

CREATE POLICY "Members: view members of shared trips"
  ON public.trip_members FOR SELECT
  USING (public.is_trip_member(trip_id));
