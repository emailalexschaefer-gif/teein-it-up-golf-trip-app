-- =============================================================================
-- 088_moments_blooper_video_only.sql
-- =============================================================================
-- Event Memories V1.4 completion patch (14 Sep) -- the brief's own
-- explicit request: "assess whether the database should enforce that
-- is_blooper=true is valid only when moment_type='video' ... prefer
-- preventing invalid state if it can be done cleanly without
-- complicating existing Moment behaviour."
--
-- ASSESSMENT: yes, cleanly achievable. is_blooper and moment_type are
-- both columns on the same moments row -- this needs only a plain
-- CHECK constraint, not a trigger (a trigger would only be required
-- if the rule depended on another table's data, which it doesn't).
-- This is additive and non-disruptive: every existing row already
-- satisfies it (086 added is_blooper defaulting to false for every
-- row, including every existing photo/text Moment, so no existing
-- data violates "is_blooper=true implies moment_type='video'" before
-- this constraint is even added).
--
-- This was deliberately deferred out of 086 itself, rather than
-- rushed into the same migration that introduced is_blooper -- adding
-- it as its own, explicitly-reasoned migration here keeps each
-- change's intent legible on its own, and matches how this
-- engagement has consistently treated "add a column" and "constrain
-- a column" as separable, auditable steps.
--
-- The slideshow deck builder's own application-layer filter
-- (mediaType === 'video' in slideshowDeck.ts) remains in place
-- unchanged -- this constraint prevents the invalid state from ever
-- being written at all, which is strictly stronger than filtering it
-- out at read time, but the read-time filter is harmless defence in
-- depth and was not removed.
-- =============================================================================

ALTER TABLE public.moments DROP CONSTRAINT IF EXISTS moments_blooper_video_only_check;
ALTER TABLE public.moments ADD CONSTRAINT moments_blooper_video_only_check
  CHECK (is_blooper = false OR moment_type = 'video');

NOTIFY pgrst, 'reload schema';
