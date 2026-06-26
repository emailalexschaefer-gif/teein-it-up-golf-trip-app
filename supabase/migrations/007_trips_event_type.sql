-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION 007: Add event_type and location to trips
-- Required for Sprint 2 trip creation wizard.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS event_type TEXT DEFAULT 'golf_trip'
    CHECK (event_type IN (
      'golf_trip', 'corporate_day', 'charity_day',
      'golf_society', 'bucks_weekend', 'other'
    )),
  ADD COLUMN IF NOT EXISTS location TEXT;

-- Also add tee_time to rounds (stored as TEXT 'HH:MM' — simpler than TIME for forms)
-- Note: rounds.holes already exists from migration 004
-- trip_courses already has tee_time, but rounds need a direct tee_time too
ALTER TABLE public.rounds
  ADD COLUMN IF NOT EXISTS tee_time TEXT,         -- e.g. '08:30'
  ADD COLUMN IF NOT EXISTS course_name TEXT;       -- denormalised name for display
                                                   -- without requiring a course record
