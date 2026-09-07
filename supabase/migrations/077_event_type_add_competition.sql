-- =============================================================================
-- 077_event_type_add_competition.sql
-- =============================================================================
-- Trip -> Event terminology migration (7 Sep) -- "Competition/
-- Tournament" is one of the explicitly requested Event Type options.
--
-- Confirmed the current constraint directly (migration 061, the most
-- recent to touch trips.event_type -- verified via search that nothing
-- since has redeclared it) before writing this: it did not include a
-- 'competition' value. EVENT_TYPE_OPTIONS (src/types/app.ts) has been
-- updated in the same pass to add it -- this migration is the other,
-- required half of that change. Confirmed this codebase already has a
-- dedicated regression test for exactly this drift
-- (eventTypeConstraint.test.ts, from an earlier P0 -- migration 061's
-- own history is that exact bug class happening once before), so this
-- migration is written specifically to make that existing test pass
-- again, not merely to "probably" match the frontend.
--
-- Every other existing value (golf_trip, social_golf, corporate_day,
-- charity_day, golf_society, bucks_weekend, other) is carried forward
-- unchanged -- this widens the constraint, never narrows it, so no
-- existing trip's event_type value is invalidated.
--
-- Same "confirm the real constraint name before dropping it" discipline
-- as 036/061 -- trips_event_type_check, Postgres's own default naming
-- for this inline CHECK, confirmed already correct by both of those
-- migrations' own prior use of it.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

ALTER TABLE public.trips
  DROP CONSTRAINT IF EXISTS trips_event_type_check;

ALTER TABLE public.trips
  ADD CONSTRAINT trips_event_type_check CHECK (event_type IN (
    'golf_trip', 'social_golf', 'corporate_day', 'charity_day',
    'golf_society', 'bucks_weekend', 'competition', 'other'
  ));

NOTIFY pgrst, 'reload schema';
