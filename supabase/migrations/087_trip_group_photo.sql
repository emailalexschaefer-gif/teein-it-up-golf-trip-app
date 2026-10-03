-- =============================================================================
-- 087_trip_group_photo.sql
-- =============================================================================
-- Event Memories V1.4 completion patch (14 Sep) -- Group Photo
-- selection, persisted (not session-only), so the organiser's choice
-- survives between visits the same way Favourites already do.
--
-- CARDINALITY: a trip has at most ONE Group Photo, never many -- a
-- fundamentally different shape from Favourites/Bloopers (both
-- many-per-trip, modelled as a boolean on moments). A boolean column
-- on moments (is_group_photo) would allow multiple rows to be
-- flagged simultaneously and need application-layer enforcement to
-- stay correct. A single nullable foreign key on trips enforces the
-- "exactly one or none" shape structurally, with no possibility of
-- two moments both being "the" group photo at once -- the schema
-- itself cannot represent that invalid state, which is the more
-- robust choice when the cardinality is already known to be 0-or-1.
--
-- ON DELETE SET NULL: if the underlying Moment is ever removed, the
-- trip simply loses its Group Photo selection rather than the
-- deletion being blocked or cascading unexpectedly.
-- =============================================================================

ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS group_photo_moment_id UUID REFERENCES public.moments(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.trips.group_photo_moment_id IS
  'Organiser-selected Group Photo for this event''s Event Highlights presentation. At most one per trip, by construction (a single nullable FK, not a boolean on moments). Must reference a moment_type = photo row -- enforced at the application layer (see the group-photo API route), not a database CHECK, since validating against another table''s column requires a trigger rather than a simple constraint, and the brief''s own scope for this patch is additive/non-disruptive to existing Moment behaviour.';

NOTIFY pgrst, 'reload schema';
