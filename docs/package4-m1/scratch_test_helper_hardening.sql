-- Behaviour-equivalence test for the helper hardening proposal: BEFORE vs AFTER over every (user, trip) combination, including no user,
-- plus a hostile search_path (a same-named table in a schema the caller controls) to show the unpinned version is the one at risk.
\set ON_ERROR_STOP on
-- Recreate the helpers EXACTLY as shipped in supabase/migrations/002_trips.sql (parameter name trip_uuid, no search_path) so the test uses the real baseline.
DROP FUNCTION IF EXISTS public.is_trip_member(uuid) CASCADE; DROP FUNCTION IF EXISTS public.is_trip_organiser(uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.is_trip_member(trip_uuid UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.trip_members
    WHERE trip_id = trip_uuid AND profile_id = auth.uid()
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.is_trip_organiser(trip_uuid UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.trip_members
    WHERE trip_id = trip_uuid AND profile_id = auth.uid() AND role = 'organiser'
  );
END;
$$;
CREATE TEMP TABLE before_ AS SELECT u.uid, t.trip, public.is_trip_member(t.trip) AS m, public.is_trip_organiser(t.trip) AS o FROM
  (SELECT unnest(ARRAY['00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-0000000000a5',NULL]::text[]) uid) u,
  (SELECT unnest(ARRAY['10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000099']::uuid[]) trip) t LIMIT 0;
CREATE FUNCTION pg_temp.snap() RETURNS TABLE(uid text, trip uuid, m boolean, o boolean) LANGUAGE plpgsql AS $$
DECLARE u text; t uuid;
BEGIN
  FOREACH u IN ARRAY ARRAY['00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-0000000000a5',''] LOOP
    PERFORM set_config('app.uid', u, false);
    FOREACH t IN ARRAY ARRAY['10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000099']::uuid[] LOOP
      uid := u; trip := t; m := public.is_trip_member(t); o := public.is_trip_organiser(t); RETURN NEXT;
    END LOOP;
  END LOOP;
END $$;
INSERT INTO trips (id,name) VALUES ('10000000-0000-0000-0000-000000000001','T1'),('10000000-0000-0000-0000-000000000002','T2') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id) VALUES ('00000000-0000-0000-0000-0000000000a1'),('00000000-0000-0000-0000-0000000000a3'),('00000000-0000-0000-0000-0000000000a4'),('00000000-0000-0000-0000-0000000000a5') ON CONFLICT DO NOTHING;
INSERT INTO trip_members (trip_id,profile_id,role) VALUES ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','member'),('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a3','organiser'),('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a5','organiser') ON CONFLICT DO NOTHING;
CREATE TEMP TABLE snap_before AS SELECT * FROM pg_temp.snap();
SELECT 'before: unpinned search_path' AS state, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname IN ('is_trip_member','is_trip_organiser') AND p.proconfig IS NULL)) > 0 AS helpers_unpinned FROM snap_before LIMIT 1;
\i PROPOSED_helper_hardening_search_path.sql
CREATE TEMP TABLE snap_after AS SELECT * FROM pg_temp.snap();
SELECT 'identical answers across all user x trip combinations' AS check, (SELECT count(*) FROM snap_before) AS combos,
       (SELECT count(*) FROM snap_before b JOIN snap_after a USING (uid, trip) WHERE b.m IS DISTINCT FROM a.m OR b.o IS DISTINCT FROM a.o) AS differences;
SELECT 'signatures and security type preserved' AS check, string_agg(p.proname||'('||pg_get_function_identity_arguments(p.oid)||') secdef='||p.prosecdef||' cfg='||coalesce(array_to_string(p.proconfig,';'),'none'), ' | ' ORDER BY p.proname) FROM pg_proc p WHERE p.proname IN ('is_trip_member','is_trip_organiser');
SELECT 'dependent policies still attached' AS check, count(*) AS policies_calling_helpers FROM pg_policies WHERE qual LIKE '%is_trip_%' OR with_check LIKE '%is_trip_%';
-- hostile search_path: a lookalike table in a caller-controlled schema must not be consulted
CREATE SCHEMA evil; CREATE TABLE evil.trip_members (trip_id uuid, profile_id uuid, role text);
INSERT INTO evil.trip_members VALUES ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a4','organiser');
SET search_path = evil, public;
SELECT set_config('app.uid','00000000-0000-0000-0000-0000000000a4',false);
SELECT 'hostile search_path cannot make an outsider an organiser' AS check, public.is_trip_organiser('10000000-0000-0000-0000-000000000002') AS outsider_is_organiser;
RESET search_path;
