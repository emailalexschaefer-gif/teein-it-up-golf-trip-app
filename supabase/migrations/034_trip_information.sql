-- =============================================================================
-- 034_trip_information.sql
-- =============================================================================
-- Adds a single nullable trip_information column to trips, for the V1
-- "paste, save, done" Trip Information feature. Purely additive — no
-- existing column touched, no data migration needed (existing trips
-- simply have trip_information = null, which is exactly the documented
-- empty state).
--
-- Permissions are enforced at the API layer (see
-- src/app/api/trips/[tripId]/information/route.ts), not by relying on
-- the existing "Anyone: read by invite code" trips RLS policy — that
-- policy exists for the pre-join invite flow and grants row-level read
-- access to non-members for that specific purpose. Since RLS policies
-- are row-level, not column-level, that policy would technically also
-- expose this new column to non-members, which is exactly the risk the
-- brief's "do not rely only on hiding the Edit button" (and the
-- corresponding "enforce server-side" instruction) is guarding against.
-- The dedicated API route below never relies on that policy: GET
-- explicitly checks trip_members before returning trip_information at
-- all, and PATCH explicitly checks organiser_id.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS trip_information TEXT;

NOTIFY pgrst, 'reload schema';
