-- =============================================================================
-- 090_moments_blooper_media_decoupling.sql
-- =============================================================================
-- V1.6 (5 Oct). Live testing/product review surfaced a real conflation:
-- migration 088 made is_blooper = true valid only when
-- moment_type = 'video', on the (now-corrected) assumption that a
-- Blooper was inherently a video concept. The actual product rule is
-- the opposite: media type and storytelling classification are two
-- separate concepts. A photo can be a Moment or a Blooper. A video can
-- be a Moment or a Blooper. A great shot captured on video is a
-- Moment; a ridiculous photo can absolutely be a Blooper. 088's own
-- constraint was therefore actively wrong, not just incomplete, and is
-- replaced here rather than loosened in place.
--
-- A text Moment remains excluded from Blooper eligibility -- not
-- because of this migration's own judgement, but because a text
-- Moment has no visual/video content at all (image_path is NULL for
-- moment_type = 'text', per migration 030/086's own well-formed-row
-- constraint), and the Bloopers presentation chapter is inherently a
-- visual/video chapter. This is the same boundary 086 already drew for
-- the Bloopers chapter itself (slideshowDeck.ts filters to
-- mediaType === 'video' there; this session additionally allows
-- mediaType === 'photo' there too, see the accompanying code change) --
-- never text.
--
-- SAFETY: additive and non-destructive. Dropping and replacing a CHECK
-- constraint changes no existing row's data -- every Moment currently
-- in the table already satisfies the OLD, narrower constraint, so it
-- trivially satisfies this new, WIDER one too (every row the old
-- constraint allowed is still allowed; this only permits additional
-- cases the old one rejected). No ADD COLUMN, no backfill needed.
-- =============================================================================

ALTER TABLE public.moments DROP CONSTRAINT IF EXISTS moments_blooper_video_only_check;

ALTER TABLE public.moments ADD CONSTRAINT moments_blooper_media_check
  CHECK (is_blooper = false OR moment_type IN ('photo', 'video'));

COMMENT ON COLUMN public.moments.is_blooper IS
  'Organiser-selected inclusion in the Bloopers/Outtakes presentation chapter. V1.6 (5 Oct): valid for both photo and video Moments (never text) -- media type and storytelling classification are independent; a video can be a Moment and a photo can be a Blooper. Never auto-classified from moment_type alone -- the organiser explicitly chooses, matching is_event_favourite (085)''s own pattern, and is independent of it too.';

NOTIFY pgrst, 'reload schema';
