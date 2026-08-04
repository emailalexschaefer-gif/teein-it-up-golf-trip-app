-- =============================================================================
-- 033_social_golf_event_type.sql
-- =============================================================================
-- Adds 'social_golf' as a valid trips.event_type value. Purely additive —
-- every existing value ('golf_trip', 'corporate_day', 'charity_day',
-- 'golf_society', 'bucks_weekend', 'other') is preserved exactly, so
-- existing events are entirely unaffected. No data migration needed:
-- existing rows already satisfy the widened constraint.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_event_type_check;
ALTER TABLE public.trips ADD CONSTRAINT trips_event_type_check
  CHECK (event_type IN (
    'golf_trip', 'social_golf', 'corporate_day', 'charity_day',
    'golf_society', 'bucks_weekend', 'other'
  ));

NOTIFY pgrst, 'reload schema';
