-- =============================================================================
-- 030_text_moments.sql
-- =============================================================================
-- Sprint 6.1 Package 2 — the Moment composer now offers a "Text Moment"
-- option alongside Take Photo / Choose from Gallery, per the explicit
-- requirement that tapping Moment opens a composer first rather than
-- immediately opening the phone's file picker. A text-only Moment has no
-- image, so image_path needs to become nullable rather than NOT NULL.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

ALTER TABLE public.moments ALTER COLUMN image_path DROP NOT NULL;

ALTER TABLE public.moments ADD COLUMN IF NOT EXISTS moment_type TEXT NOT NULL DEFAULT 'photo';
ALTER TABLE public.moments DROP CONSTRAINT IF EXISTS moments_moment_type_check;
ALTER TABLE public.moments ADD CONSTRAINT moments_moment_type_check
  CHECK (moment_type IN ('photo', 'text'));

-- A photo Moment must have an image; a text Moment must not have one but
-- must have a caption (otherwise there's nothing to show).
ALTER TABLE public.moments DROP CONSTRAINT IF EXISTS moments_type_consistency_check;
ALTER TABLE public.moments ADD CONSTRAINT moments_type_consistency_check
  CHECK (
    (moment_type = 'photo' AND image_path IS NOT NULL)
    OR (moment_type = 'text' AND image_path IS NULL AND caption IS NOT NULL AND char_length(caption) > 0)
  );

NOTIFY pgrst, 'reload schema';
