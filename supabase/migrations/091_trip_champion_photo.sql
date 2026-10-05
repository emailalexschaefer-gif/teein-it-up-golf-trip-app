-- =============================================================================
-- 091_trip_champion_photo.sql
-- =============================================================================
-- V1.6 (5 Oct) -- Champion Photo selection, mirroring Group Photo
-- (087) exactly: a trip has at most ONE Champion Photo, never many --
-- a single nullable FK is the structurally-correct shape for the same
-- reason 087 already established, not re-litigated here.
--
-- The brief's own priority order (Champion Photo selected -> use it;
-- no Champion Photo -> suitable photo associated with the champion if
-- reliably available; nothing suitable -> fall back to Group Photo)
-- is implemented entirely in application code (slideshowDeck.ts's own
-- champion slide generation) -- this column only stores the explicit,
-- top-priority organiser override. The middle and bottom tiers of the
-- fallback chain use data that already exists (the champion's own
-- Favourite photos; the existing Group Photo selection) and need no
-- schema of their own.
--
-- ON DELETE SET NULL: matches 087 -- if the underlying Moment is ever
-- removed, the trip simply loses its Champion Photo selection rather
-- than the deletion being blocked or cascading unexpectedly.
-- =============================================================================

ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS champion_photo_moment_id UUID REFERENCES public.moments(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.trips.champion_photo_moment_id IS
  'Organiser-selected photo for the Event Champion slide, chosen after the event once the champion is known. At most one per trip (a single nullable FK). Must reference a moment_type = photo row -- enforced at the application layer (see the champion-photo API route), same pattern as group_photo_moment_id (087). Falls back to a Favourite photo of the champion, then to the Group Photo, when unset -- see buildPresentationDeck/buildCoreSlides in slideshowDeck.ts for the fallback chain itself.';

NOTIFY pgrst, 'reload schema';
