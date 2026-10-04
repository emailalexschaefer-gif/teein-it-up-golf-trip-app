-- =============================================================================
-- 089_production_moments_schema_reconciliation.sql
-- =============================================================================
-- PRODUCTION SCHEMA DRIFT REPAIR (15 Sep).
--
-- ROOT CAUSE, confirmed by auditing the real migration files, not
-- guessed from migration numbers: production has migration 087's
-- schema change (trips.group_photo_moment_id exists) but is missing
-- migration 030's (moments.moment_type does not exist), meaning 030
-- itself was never applied, despite later, independent migrations
-- (063 captured_by, 085 is_event_favourite, 087 group_photo_moment_id)
-- having been applied successfully. This is possible specifically
-- because 063/085/087 do not depend on moment_type at all -- each is
-- a self-contained ADD COLUMN against moments/trips with no reference
-- to the others -- so their success or failure was never coupled to
-- 030's. Migration 086 (duration_seconds/is_blooper/video support)
-- explicitly assumes moment_type already exists (it only ALTERs an
-- existing CHECK constraint, never creates the column itself), so it
-- fails immediately and correctly with "column moment_type does not
-- exist" the moment it's attempted -- exactly the error observed.
--
-- A SECOND, SEPARATE BUG WAS FOUND DURING THIS AUDIT, FIXED HERE AND
-- IN 086 ITSELF: 086's own constraint-replacement step only dropped a
-- constraint named moments_well_formed_check -- but 030 actually
-- named its version moments_type_consistency_check. On a database
-- where 030 HAD run in sequence, 086 would have left 030's original,
-- narrower constraint (photo/text only) active ALONGSIDE its own new
-- one, silently rejecting every future video row. This never
-- manifested in THIS production database only because 030 never ran
-- at all, so that stale constraint was never created to begin with --
-- but it is a real latent bug for any fresh/future deployment, and is
-- fixed directly in 086's own file as part of this same audit, not
-- just worked around here.
--
-- CONSEQUENCE FOR THE LIVE APP, also confirmed directly: the current
-- POST /api/trips/[tripId]/moments route unconditionally includes
-- moment_type and duration_seconds in every insert payload, for a
-- PLAIN PHOTO upload as much as a video one (duration_seconds is set
-- to null for a photo, but the column reference itself is still
-- present in the insert). This means every new Moment upload of any
-- kind -- not just video -- has been failing since this code was
-- deployed, matching the PGRST204 "could not find the duration_seconds
-- column" error reported directly. The 5 existing photos are not at
-- risk from this migration and are not evidence of anything broken on
-- their own -- they were inserted successfully before this code
-- existed, and this reconciliation does not touch their data, only
-- adds the missing columns/constraints the newer code now expects.
--
-- REVISED (15 Sep, second pass) -- a blocking column-dependency-order
-- bug was found in the first version of this migration before it was
-- ever run against production: the first draft added the final
-- moment_type='video' consistency constraint (which references
-- duration_seconds) BEFORE the duration_seconds column itself existed
-- -- Postgres would have rejected that ADD CONSTRAINT outright with
-- "column duration_seconds does not exist", on a database that, by
-- this migration's own diagnosis, does not yet have that column. Every
-- column a constraint references is now added strictly before that
-- constraint is ever created -- verified explicitly this time, not
-- just checked for balanced parentheses/syntax, which is exactly what
-- let the ordering bug through the first time.
--
-- ATOMICITY: the entire schema reconciliation (every ALTER/CREATE
-- INDEX/COMMENT/UPDATE below) is wrapped in an explicit BEGIN/COMMIT
-- block, rather than relying on however the SQL Editor happens to
-- submit a multi-statement script. This makes the all-or-nothing
-- guarantee explicit and verifiable rather than implicit: if any
-- statement inside the transaction fails for any reason, every
-- statement before it in this same run is rolled back too -- your
-- existing Moments are left exactly as they were before this
-- migration was attempted, with certainty, not just by design intent.
-- NOTIFY is issued after COMMIT, once the schema change is actually
-- durable, not from inside the transaction.
--
-- SAFETY GUARANTEES (otherwise unchanged from the first pass):
--   - No DROP TABLE, no TRUNCATE, no data-rewriting UPDATE against
--     moments anywhere in this file. Every operation is either an
--     additive ADD COLUMN IF NOT EXISTS, or a constraint replacement
--     (DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT) -- both safe,
--     reversible schema-only operations that never delete or modify
--     the content of any existing row.
--   - moment_type is added as NOT NULL DEFAULT 'photo' -- PostgreSQL
--     backfills this default into every existing row automatically
--     as part of the ALTER TABLE itself; no separate UPDATE statement
--     is needed or included. Every existing row was necessarily
--     inserted under the ORIGINAL migration 028 schema (image_path
--     was NOT NULL at the database level before 030 ever ran, since
--     030 is precisely the migration that made it nullable) -- so
--     every existing row is guaranteed to already have a real
--     image_path, meaning it correctly satisfies "moment_type='photo'
--     AND image_path IS NOT NULL" the moment that default is applied.
--   - PostgreSQL's own ADD CONSTRAINT validates every existing row
--     BEFORE committing -- if any row genuinely violated the new
--     constraint, this statement (and, now, the whole transaction)
--     fails and NO data is altered.
--   - Every statement is written to be safely re-runnable (IF NOT
--     EXISTS / IF EXISTS patterns throughout) -- running this
--     migration twice is a no-op the second time, not an error.
--   - 087 is re-applied defensively (ADD COLUMN IF NOT EXISTS) even
--     though your own screenshot already confirms it's present --
--     this is a genuine no-op in that case, included only so this
--     single file is a complete, trustworthy reconciliation on its
--     own. 085 (is_event_favourite) is included the same way,
--     defensively, in case it was also skipped.
-- =============================================================================

BEGIN;

-- ---- Step 1: drop image_path's NOT NULL (migration 030) ----

ALTER TABLE public.moments ALTER COLUMN image_path DROP NOT NULL;

-- ---- Step 2: add moment_type (migration 030) -- every subsequent
-- step and constraint depends on this column existing. ----

ALTER TABLE public.moments ADD COLUMN IF NOT EXISTS moment_type TEXT NOT NULL DEFAULT 'photo';

-- ---- Step 3: add duration_seconds (migration 086) -- added here,
-- BEFORE any constraint that references it, specifically to fix the
-- ordering bug described above. ----

ALTER TABLE public.moments ADD COLUMN IF NOT EXISTS duration_seconds NUMERIC(4,1);

-- ---- Step 4: add is_blooper (migration 086) -- added here, BEFORE
-- the Blooper/video-only constraint that references it. ----

ALTER TABLE public.moments ADD COLUMN IF NOT EXISTS is_blooper BOOLEAN NOT NULL DEFAULT false;

-- ---- Step 5: drop any possible prior version of every constraint
-- this migration is about to (re)create, under every name that has
-- ever existed across the migration history. Each DROP is a safe
-- no-op if that name never existed in this database (confirmed: true
-- for all of them here, since neither 030 nor 086 nor 088 ever ran)
-- -- included so this migration is correct regardless of which
-- partial history any given environment actually has. ----

ALTER TABLE public.moments DROP CONSTRAINT IF EXISTS moments_moment_type_check;
ALTER TABLE public.moments DROP CONSTRAINT IF EXISTS moments_type_consistency_check;
ALTER TABLE public.moments DROP CONSTRAINT IF EXISTS moments_well_formed_check;
ALTER TABLE public.moments DROP CONSTRAINT IF EXISTS moments_blooper_video_only_check;

-- ---- Step 6: the final moment_type CHECK constraint (030's original
-- intent, widened to 086's three-value set directly, in one pass). ----

ALTER TABLE public.moments ADD CONSTRAINT moments_moment_type_check
  CHECK (moment_type IN ('photo', 'text', 'video'));

-- ---- Step 7: the final photo/text/video consistency constraint.
-- Every column it references (image_path, moment_type, caption,
-- duration_seconds) now already exists, from Steps 1-3 above. ----

ALTER TABLE public.moments ADD CONSTRAINT moments_well_formed_check
  CHECK (
    (moment_type = 'photo' AND image_path IS NOT NULL)
    OR (moment_type = 'text' AND image_path IS NULL AND caption IS NOT NULL AND char_length(caption) > 0)
    OR (moment_type = 'video' AND image_path IS NOT NULL AND duration_seconds IS NOT NULL)
  );

-- ---- Step 8: the Blooper/video-only constraint (migration 088).
-- is_blooper and moment_type both already exist, from Steps 2 and 4
-- above. ----

ALTER TABLE public.moments ADD CONSTRAINT moments_blooper_video_only_check
  CHECK (is_blooper = false OR moment_type = 'video');

-- ---- Step 9: indexes and column comments (migration 086). ----

CREATE INDEX IF NOT EXISTS moments_trip_blooper_idx
  ON public.moments(trip_id) WHERE is_blooper = true;

COMMENT ON COLUMN public.moments.duration_seconds IS
  'Required for moment_type = video. The authoritative clip length, used by Event Highlights playback to time auto-advance -- never re-derived from the file at render time.';
COMMENT ON COLUMN public.moments.is_blooper IS
  'Organiser-selected inclusion in the Bloopers/Outtakes presentation chapter. Never auto-classified from moment_type alone -- the organiser explicitly chooses, matching is_event_favourite (085)''s own pattern.';

-- ---- Step 10: Storage bucket -- widen to accept video (migration 086). ----

UPDATE storage.buckets
SET file_size_limit = 52428800,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']
WHERE id = 'event-moments';

-- ---- Step 11: defensive re-application of 085 and 087, in case
-- either was also skipped in this environment's history -- genuine
-- no-ops if already present, confirmed safe to re-run. ----

ALTER TABLE public.moments ADD COLUMN IF NOT EXISTS is_event_favourite BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS moments_trip_favourite_idx
  ON public.moments(trip_id) WHERE is_event_favourite = true;

ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS group_photo_moment_id UUID REFERENCES public.moments(id) ON DELETE SET NULL;

COMMIT;

-- ---- Step 12: PostgREST schema cache reload. Issued AFTER COMMIT,
-- once the schema change is actually durable -- not from inside the
-- transaction. REQUIRED -- Supabase's PostgREST layer caches the
-- table schema it discovered at startup/last reload; a column that
-- exists in Postgres but isn't yet in that cache produces exactly the
-- PGRST204 "could not find column" error reported, even once the
-- column genuinely exists. NOTIFY is the correct, immediate mechanism
-- (no manual project restart needed in the normal case) -- but if the
-- application still reports the same error a minute or two after
-- running this migration, that specifically points at the cache not
-- having reloaded yet, not at the schema change having failed, and a
-- manual "restart" from the Supabase dashboard's API settings is the
-- next step in that specific case.

NOTIFY pgrst, 'reload schema';
