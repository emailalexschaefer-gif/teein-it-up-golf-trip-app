-- =============================================================================
-- Verification queries for 089_production_moments_schema_reconciliation.sql
-- =============================================================================
-- Run these immediately after the migration, in order. Each one should
-- produce the stated expected result. If any does not, STOP and report
-- back the actual output before taking any further action -- do not
-- proceed to retry the migration or touch the schema further.

-- 1. Confirm all four columns now exist on moments, with the correct types.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'moments'
  AND column_name IN ('moment_type', 'duration_seconds', 'is_blooper', 'image_path')
ORDER BY column_name;
-- EXPECTED: 4 rows.
--   moment_type:      text,    NOT NULL, default 'photo'::text
--   duration_seconds: numeric, NULLABLE
--   is_blooper:       boolean, NOT NULL, default false
--   image_path:       text,    NULLABLE  (confirms the 030 nullable change applied)

-- 2. Confirm all three constraints exist and are active.
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.moments'::regclass
  AND conname IN ('moments_moment_type_check', 'moments_well_formed_check', 'moments_blooper_video_only_check')
ORDER BY conname;
-- EXPECTED: 3 rows, with definitions matching the CHECK clauses in
-- migration 089 (moment_type IN photo/text/video; the three-branch
-- well-formed check; is_blooper = false OR moment_type = 'video').

-- 3. CRITICAL -- confirm your 5 existing Moments are genuinely untouched:
-- same row count, same ids, now correctly typed as 'photo' with their
-- original image_path intact.
SELECT id, trip_id, moment_type, image_path, duration_seconds, is_blooper, created_at
FROM public.moments
ORDER BY created_at;
-- EXPECTED: exactly 5 rows (or however many you had before -- the
-- point is this number must be UNCHANGED from before the migration).
-- Every row: moment_type = 'photo', image_path IS NOT NULL (your
-- original photo path, unchanged), duration_seconds IS NULL,
-- is_blooper = false.

-- 4. Confirm the Storage bucket now accepts video.
SELECT id, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id = 'event-moments';
-- EXPECTED: file_size_limit = 52428800 (50MB), allowed_mime_types
-- includes video/mp4, video/webm, video/quicktime alongside the
-- original three image types.

-- 5. Confirm trips.group_photo_moment_id is present (defensive
-- re-check -- your own screenshot already confirmed this, this just
-- closes the loop).
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'trips' AND column_name = 'group_photo_moment_id';
-- EXPECTED: 1 row, data_type = uuid.

-- 6. Only once every query above matches its expected result: attempt
-- a real Moment upload (a plain photo) from the live app, and confirm
-- it succeeds with no PGRST204 error. If it still fails with the same
-- error after all six queries above look correct, the schema change
-- itself succeeded but PostgREST's schema cache has not yet picked it
-- up -- wait a minute and retry, or manually restart the API from the
-- Supabase dashboard's project settings.
