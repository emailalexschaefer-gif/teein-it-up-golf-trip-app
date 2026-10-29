-- =============================================================================
-- PROPOSAL ONLY -- NOT A MIGRATION. NOT RUN ANYWHERE REAL. Lives in docs/, not supabase/migrations/. Needs explicit approval.
-- Separate from migration 104 on purpose (approved: keep it a separate, reviewed, versioned change).
--
-- Purpose: pin `search_path` on the two existing SECURITY DEFINER RLS helpers, which currently have none. A SECURITY DEFINER function
-- without a pinned search_path resolves unqualified names using the CALLER's search_path, which is the classic privilege-escalation
-- footgun. 33 migration files and every RLS policy that calls these helpers depend on them, so the change is deliberately minimal:
--   * same name, same argument types, same return type, same language, same SECURITY DEFINER;
--   * the body is byte-for-byte the shipped body (002_trips.sql), except that table names are already schema-qualified there;
--   * only `SET search_path = pg_catalog, public, pg_temp` is added.
-- CREATE OR REPLACE keeps the function OID, so every dependent policy and every existing GRANT is untouched.
--
-- PRIVILEGES: deliberately NOT changed. RLS policy expressions run as the querying role (including `anon`); revoking EXECUTE from anon
-- would turn "no rows" into "permission denied" errors on public/anon paths. The helpers only read the caller's own membership via
-- auth.uid() and return a boolean, so default execute is acceptable. Review item for the approver: confirm in production with
--   select proname, proacl from pg_proc where proname in ('is_trip_member','is_trip_organiser');
--
-- Rollback = re-run the original definitions from 002_trips.sql (no data is touched).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.is_trip_member(trip_uuid UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.trip_members
    WHERE trip_id = trip_uuid AND profile_id = auth.uid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_trip_organiser(trip_uuid UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.trip_members
    WHERE trip_id = trip_uuid AND profile_id = auth.uid() AND role = 'organiser'
  );
END;
$$;
