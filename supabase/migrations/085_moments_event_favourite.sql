-- =============================================================================
-- 085_moments_event_favourite.sql
-- =============================================================================
-- Event Memories V1 (10 Sep), Part 6 -- organiser favourite/selection.
--
-- SCHEMA AUDITED FIRST, per the explicit instruction: moments (028) is
-- already the single canonical record for a captured photo -- one row,
-- referenced from event_messages (Chat), side_comp_entries/
-- side_comp_lead_changes (Side Game context), with no second photo
-- table anywhere. Confirmed no existing column already serves this
-- purpose before adding one.
--
-- CHOSEN: a single BOOLEAN column, moments.is_event_favourite, not a
-- separate event_memory_selections relationship table. Only one
-- selection category exists right now (the organiser's own "best
-- Moments" pick) -- a relationship table earns its complexity when a
-- second category actually exists to relate against, not before, per
-- the brief's own "do not over-engineer" instruction. If a second
-- category is ever needed (e.g. a player's own favourites, distinct
-- from the organiser's), that is the point to introduce a proper
-- selections table -- not now, against a single boolean need.
--
-- Idempotent, additive only: existing moments default to false, no
-- other column or row is touched.
-- =============================================================================

ALTER TABLE public.moments
  ADD COLUMN IF NOT EXISTS is_event_favourite BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS moments_trip_favourite_idx
  ON public.moments(trip_id) WHERE is_event_favourite = true;

COMMENT ON COLUMN public.moments.is_event_favourite IS
  'Organiser-selected "best Moment" for this event, set via Event Memories. Idempotent toggle -- setting it to its current value is a no-op, never an error.';

NOTIFY pgrst, 'reload schema';
