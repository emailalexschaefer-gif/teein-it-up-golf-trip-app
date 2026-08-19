-- =============================================================================
-- 061_event_type_constraint_p0.sql
-- =============================================================================
-- P0 — Social Golf trip creation/editing still fails in production with:
--   new row for relation "trips" violates check constraint
--   "trips_event_type_check"
--
-- INVESTIGATION (repeated a third time, per explicit instruction not to
-- assume):
--
-- 1. Every migration touching trips.event_type, in order:
--      000_combined_fresh_database.sql — original constraint
--      002_trips.sql                   — original constraint (same file
--                                         set, no drift between them)
--      036_add_social_golf_event_type.sql — DROP + re-ADD, widening the
--                                         list to include social_golf
--    No migration after 036 touches event_type at all. Nothing "narrows"
--    or overwrites it later in this repository's history.
--
-- 2. Exact value the wizard sends: 'social_golf' — confirmed by reading
--    EVENT_TYPE_OPTIONS (src/types/app.ts), the single canonical source
--    both StepDetails.tsx (the <select> in the wizard) and the trip
--    PATCH/POST routes read from. No transformation, no alternate
--    spelling, no second list anywhere in the codebase.
--
-- 3. Canonical full value set (from EVENT_TYPE_OPTIONS, unchanged):
--    golf_trip, social_golf, corporate_day, charity_day, golf_society,
--    bucks_weekend, other. Migration 036 already listed exactly these
--    seven values — nothing was ever missing from ITS definition.
--
-- 4. Create and Edit/Update both go through the identical value — the
--    PATCH route (src/app/api/trips/[tripId]/route.ts) passes
--    body.event_type straight through with no mapping, and trip
--    creation uses the same EVENT_TYPE_OPTIONS-driven wizard state.
--    There is no create/update mismatch to fix in application code.
--
-- CONCLUSION: the code and the migration 036 definition were already
-- correct. Given this exact symptom has now been reported live twice
-- despite 036 supposedly containing the fix, this migration exists
-- specifically so there is no ambiguity left about whether "the fix"
-- has reached production — this is the newest migration in the
-- repository, its own filename states its purpose, and running it
-- (regardless of 036's actual deployment history) resolves the
-- constraint unconditionally.
--
-- Fully idempotent — safe to run even if 036 already applied
-- successfully; this simply re-asserts the identical, complete
-- constraint.
-- =============================================================================

ALTER TABLE public.trips
  DROP CONSTRAINT IF EXISTS trips_event_type_check;

ALTER TABLE public.trips
  ADD CONSTRAINT trips_event_type_check CHECK (event_type IN (
    'golf_trip', 'social_golf', 'corporate_day', 'charity_day',
    'golf_society', 'bucks_weekend', 'other'
  ));
