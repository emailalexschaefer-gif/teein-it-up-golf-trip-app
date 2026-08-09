-- =============================================================================
-- verify_event_moments_bucket.sql
-- =============================================================================
-- Bug 3 diagnostic — confirms whether the event-moments bucket and its
-- storage policies actually exist in the Supabase project this is run
-- against. Run this FIRST, before re-running the deploy script, to see
-- exactly what's missing.
-- =============================================================================

-- Step 1: does the bucket exist at all?
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'event-moments';
-- Expected: one row, public = false, file_size_limit = 8388608.
-- Zero rows = the bucket genuinely does not exist in this project —
-- run supabase/moments_deploy.sql (or migration 028) against THIS
-- project.

-- Step 2: do the three storage policies exist?
select policyname, cmd
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'Moments storage:%'
order by policyname;
-- Expected: three rows —
--   "Moments storage: member upload own folder" | INSERT
--   "Moments storage: owner delete"              | DELETE
--   "Moments storage: trip members read"         | SELECT
-- Fewer than three = the bucket may exist but policies are incomplete
-- (e.g. a partial/interrupted prior run) — re-running the deploy
-- script is safe regardless (DROP POLICY IF EXISTS / ON CONFLICT DO
-- NOTHING throughout).

-- =============================================================================
-- IMPORTANT — cannot be checked by this query, or from this sandbox:
-- Confirm this query is being run against the SAME Supabase project
-- Vercel's production deployment actually points to. Compare the
-- project ref in this SQL editor's URL against
-- NEXT_PUBLIC_SUPABASE_URL in Vercel's production environment
-- variables. If the bucket shows as existing here but the app still
-- reports "Bucket not found" in production, a project mismatch is the
-- most likely explanation — e.g. this bucket was created in a
-- dev/staging Supabase project while Vercel's production deployment
-- points at a different one.
-- =============================================================================
