-- =============================================================================
-- 086_moments_video_support.sql
-- =============================================================================
-- Event Memories V1.4 (14 Sep), Part 12 -- schema/storage foundation
-- for short video Moments ("bloopers").
--
-- AUDITED FIRST, per the explicit instruction, before writing this:
--   - moments.moment_type is CHECK-constrained to ('photo', 'text')
--     only (migration 030) -- no 'video' value is currently possible.
--   - The 030 migration also enforces, via a CHECK constraint, that
--     moment_type = 'photo' implies image_path IS NOT NULL, and
--     moment_type = 'text' implies image_path IS NULL AND caption IS
--     NOT NULL -- a third branch is needed for 'video'.
--   - The event-moments Storage bucket (migration 028) is configured
--     with file_size_limit = 8388608 (8MB) and
--     allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']
--     -- no video MIME type is permitted, and 8MB is almost certainly
--     too small for a ~10 second video at any watchable quality.
--
-- This is why a migration is genuinely required, not a judgement call
-- -- the current schema and bucket configuration cannot represent a
-- video Moment at all, by design (030's own CHECK constraint exists
-- specifically to keep 'photo' and 'text' rows well-formed, and would
-- reject a video row outright without this change).
--
-- CHOSEN APPROACH: extend the existing moments table and the existing
-- event-moments bucket, rather than a new table or a new bucket --
-- per the brief's own "prefer extending the existing Moment model
-- cleanly rather than building an unrelated video subsystem." A video
-- Moment is still fundamentally the same thing as a photo Moment
-- (captured by a player, during/around an event, with the same
-- trip/round/hole/audience/favourite/Side-Game-link provenance model
-- already built for photos in V1.1-V1.3) -- only its underlying file
-- type differs. Reusing the model means the Event Memory Manifest,
-- the export system, and the Event Story slideshow infrastructure
-- built across V1-V1.3 do not need a second, parallel concept.
--
-- duration_seconds is added specifically because the brief's own
-- "account for video duration before advancing" (playback) and
-- "approximately 10 seconds maximum" (upload constraint) both need an
-- authoritative, stored duration -- not something re-derived from the
-- file at render time on every playback.
-- =============================================================================

ALTER TABLE public.moments DROP CONSTRAINT IF EXISTS moments_moment_type_check;
ALTER TABLE public.moments ADD CONSTRAINT moments_moment_type_check
  CHECK (moment_type IN ('photo', 'text', 'video'));

-- The 030 migration's "well-formed row" constraint, extended with the
-- video branch: moment_type = 'video' implies image_path IS NOT NULL
-- (reusing image_path as the generic media-path column, rather than
-- adding a parallel video_path column, since a Moment's media file is
-- always exactly one or the other, never both) AND duration_seconds
-- IS NOT NULL (every video Moment must carry its own authoritative
-- duration -- never optional, since playback timing depends on it).
-- BUG FIX (15 Sep, discovered during the production reconciliation
-- audit): migration 030 named its own version of this constraint
-- moments_type_consistency_check, not moments_well_formed_check --
-- this statement originally only dropped the latter (a name that
-- never actually existed, since 030 never created it), so on a
-- database where 030 actually ran in sequence, this would have left
-- 030's original 'photo'/'text'-only constraint active ALONGSIDE the
-- new one below -- silently rejecting every 'video' row thereafter,
-- since the stale constraint has no video branch at all. Fixed by
-- dropping 030's real name explicitly, not just the new name this
-- migration happens to introduce.
ALTER TABLE public.moments DROP CONSTRAINT IF EXISTS moments_type_consistency_check;
ALTER TABLE public.moments DROP CONSTRAINT IF EXISTS moments_well_formed_check;
ALTER TABLE public.moments ADD CONSTRAINT moments_well_formed_check
  CHECK (
    (moment_type = 'photo' AND image_path IS NOT NULL)
    OR (moment_type = 'text' AND image_path IS NULL AND caption IS NOT NULL AND char_length(caption) > 0)
    OR (moment_type = 'video' AND image_path IS NOT NULL AND duration_seconds IS NOT NULL)
  );

ALTER TABLE public.moments ADD COLUMN IF NOT EXISTS duration_seconds NUMERIC(4,1);

-- Bloopers selection -- the organiser's explicit choice of which
-- uploaded video Moments become the presentation's closing chapter.
-- A single boolean, matching the exact pattern already established
-- for is_event_favourite (085) -- deliberately not a new table, for
-- the same "do not over-engineer a single selection category" reason
-- documented there. Only ever meaningful on a moment_type = 'video'
-- row in practice, but not CHECK-constrained to that -- the
-- application layer (not the database) is the right place to enforce
-- "only videos can be selected as Bloopers," consistent with how
-- is_event_favourite itself is not type-restricted at the database
-- level either.
ALTER TABLE public.moments ADD COLUMN IF NOT EXISTS is_blooper BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS moments_trip_blooper_idx
  ON public.moments(trip_id) WHERE is_blooper = true;

-- Storage: widen the existing event-moments bucket rather than create
-- a second bucket -- same access-control policies (trip-member read,
-- own-folder upload, owner delete, already scoped correctly in
-- migration 028) apply identically to a video object at the same
-- path convention (trip_id/round_id-or-general/player_id/filename).
-- MIME types: common mobile-capture video formats. File size limit:
-- raised to 50MB -- generous headroom for a ~10 second clip even at
-- higher bitrates/resolutions mobile devices commonly capture at,
-- while remaining far short of a size that would meaningfully risk
-- the export route's own streaming/duration budget (a handful of
-- videos per event, not hundreds of photos).
UPDATE storage.buckets
SET file_size_limit = 52428800,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']
WHERE id = 'event-moments';

COMMENT ON COLUMN public.moments.duration_seconds IS
  'Required for moment_type = video. The authoritative clip length, used by Event Highlights playback to time auto-advance -- never re-derived from the file at render time.';
COMMENT ON COLUMN public.moments.is_blooper IS
  'Organiser-selected inclusion in the Bloopers/Outtakes presentation chapter. Never auto-classified from moment_type alone -- the organiser explicitly chooses, matching is_event_favourite (085)''s own pattern.';

NOTIFY pgrst, 'reload schema';
