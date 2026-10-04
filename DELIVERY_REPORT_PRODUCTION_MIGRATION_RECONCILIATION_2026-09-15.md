# PRODUCTION SUPABASE MIGRATION FAILURE -- AUDIT + REPAIR
## Report

Build/test caveat, unchanged from every prior round: no network
access, no live database connection -- this audit is entirely from
reading the actual migration files and the production schema
information your screenshots provided, not from running anything
against your database myself. Full application test suite: 601/601
pass, confirming the one application-code bug fix below (migration
086's own constraint-name error) doesn't regress anything already
tested.

---

## ROOT CAUSE

Migration 030 was never applied to production, despite later,
independent migrations (063, 085, 087) having been applied
successfully. This is possible specifically because 063 (captured_by),
085 (is_event_favourite), and 087 (group_photo_moment_id) are each
self-contained ADD COLUMN statements with no dependency on moment_type
or on each other -- each one's success or failure was never coupled to
030's. Migration 086 is the first one that does depend on 030 (it only
ALTERs an existing CHECK constraint, it never creates moment_type
itself), so it's the first one to fail, and it failed with exactly the
error you saw -- column "moment_type" does not exist -- the moment it
was attempted, correctly and immediately, not from any corruption.

A second, separate bug was found during this audit, in migration 086
itself, not just in your production state: its own constraint-
replacement step tried to drop a constraint named
moments_well_formed_check -- but migration 030 actually named its
version moments_type_consistency_check. On a database where 030 had
run in sequence, 086 would have left 030's original, narrower
constraint (photo/text only, no video branch) active alongside its own
new one -- silently rejecting every future video insert. This never
manifested in your production database specifically because 030 never
ran at all, so that stale constraint was never created to begin with
-- but it's a real latent bug that would have bitten a fresh
deployment, or any environment where 030 did run normally. Fixed
directly in 086_moments_video_support.sql itself, not just worked
around in the reconciliation -- so this won't resurface for anyone
else.

Consequence for the live app, also confirmed directly from the code,
not inferred: POST /api/trips/[tripId]/moments unconditionally
includes moment_type and duration_seconds in every insert payload --
for a plain photo upload exactly as much as a video one
(duration_seconds is null for a photo, but the column reference is
still present). This means every new Moment upload of any kind, not
just video, has been failing since this code deployed -- matching your
own PGRST204: could not find the 'duration_seconds' column error
precisely. Your 5 existing photos are not evidence anything is wrong
with them specifically -- they were inserted successfully before this
code existed, under the original schema, and this reconciliation does
not touch their data at all, only adds the columns/constraints the
current code now expects.

## THE ONE MIGRATION TO RUN

089_production_moments_schema_reconciliation.sql (attached in full,
in the package below). Paste this entire file into the Supabase SQL
Editor and run it once. Do not run 086 separately -- 089 supersedes it
for this environment, applying 030's and 086's and 088's changes
together in the correct dependency order, collapsed into the final
target state rather than replaying narrower-then-wider intermediate
steps that would just be immediately superseded anyway.

Why this is safe for your existing 5 photos, concretely:
- No DROP TABLE, no TRUNCATE, no data-rewriting UPDATE against moments
  anywhere in the file -- every operation is either ADD COLUMN IF NOT
  EXISTS or a constraint replacement (DROP CONSTRAINT IF EXISTS + ADD
  CONSTRAINT), both schema-only, neither touches row content.
- moment_type is added NOT NULL DEFAULT 'photo' -- PostgreSQL
  backfills that default into every existing row as part of the ALTER
  TABLE itself; there's no separate UPDATE statement to get wrong.
  Every existing row is guaranteed to already have a real image_path,
  because the original (pre-030) schema had image_path TEXT NOT NULL
  -- it was never optional until 030 made it nullable, and 030 never
  ran. So every row already satisfies moment_type='photo' AND
  image_path IS NOT NULL the instant that default is applied.
- PostgreSQL validates ADD CONSTRAINT against every existing row
  before committing it. If any row genuinely violated the new
  constraint, the statement fails with a specific, named error and no
  data is altered -- this is a real safety net Postgres itself
  provides, not just something I'm asserting will work.
- Every statement is written to be safely re-runnable -- running this
  migration a second time is a no-op, not an error.

## VERIFICATION QUERIES (run immediately after, in order)

Provided as a separate file,
VERIFICATION_QUERIES_089_RECONCILIATION_2026-09-15.sql -- six queries:
confirm all four columns exist with correct types; confirm all three
constraints exist with the expected definitions; confirm your existing
Moments (count + ids + their original image_path) are genuinely
unchanged; confirm the Storage bucket now accepts video MIME types;
confirm group_photo_moment_id is present; and only once every one of
those matches, attempt one real photo upload from the live app as the
final, practical confirmation.

## SCHEMA RELOAD -- YES, REQUIRED, AND HANDLED

The migration ends with NOTIFY pgrst, 'reload schema';. This is
necessary because Supabase's PostgREST layer caches the schema it
discovered at startup/last reload -- a column that exists in Postgres
but isn't yet in that cache produces exactly the PGRST204 error you
saw, even after the column genuinely exists. NOTIFY is the correct,
immediate mechanism and normally takes effect without a manual
restart. If the app still reports the same error a minute or two after
running the migration, that specifically points at the cache not
having picked up the change yet (not at the schema change having
failed) -- a manual "restart" from the Supabase dashboard's API
settings is the next step in that specific case, not re-running any
SQL.

## FILES CHANGED

- `supabase/migrations/089_production_moments_schema_reconciliation.sql` (new -- the migration to run)
- `supabase/migrations/086_moments_video_support.sql` (bug fix -- corrected the constraint name it drops, so this doesn't resurface for any other environment)
- `VERIFICATION_QUERIES_089_RECONCILIATION_2026-09-15.sql` (new -- not a migration, run manually after)

## TEST-SUITE RESULT

601/601 pass -- identical to the prior session's count, confirming the
086 fix (a constraint-name correction only) doesn't affect any
already-tested application logic. No new application-level tests were
added this session -- this is a database-migration/schema-audit
delivery, not a feature change.

## WHAT STILL REQUIRES YOU TO ACTUALLY DO IT

Everything -- I cannot run SQL against your production database from
here. In order: back up if you have any automatic snapshot/point-in-
time recovery available (standard precaution, not because anything
here is expected to need it); run 089 in the SQL Editor; run the six
verification queries and confirm each matches its expected result
before doing anything else; only then attempt a real photo upload from
the app to confirm the fix end-to-end; and only after that, attempt a
real video upload specifically, since that's the feature this chain of
migrations exists for in the first place.
