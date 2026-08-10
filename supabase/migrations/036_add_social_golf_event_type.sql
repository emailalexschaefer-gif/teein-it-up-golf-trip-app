-- ─────────────────────────────────────────────────────────────────────────────
-- 036: Add 'social_golf' to the trips.event_type CHECK constraint
--
-- trips.event_type is a TEXT column with an inline CHECK constraint listing
-- the allowed values (see 002_trips.sql / 000_combined_fresh_database.sql).
-- Postgres auto-named it trips_event_type_check since no name was given.
-- Adding a new event type requires widening this constraint - there is no
-- separate enum type to alter.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.trips
  DROP CONSTRAINT IF EXISTS trips_event_type_check;

ALTER TABLE public.trips
  ADD CONSTRAINT trips_event_type_check CHECK (event_type IN (
    'golf_trip','social_golf','corporate_day','charity_day',
    'golf_society','bucks_weekend','other'
  ));
