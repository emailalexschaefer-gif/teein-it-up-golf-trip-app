-- =============================================================================
-- 046_champions_black_tee_confirmed.sql
-- =============================================================================
-- Data-only correction. The official Sandhurst Champions Course page's
-- own descriptive prose (the same page migration 044 sourced hole data
-- from) states: "At 506 metres off the black tee" for hole 3, and
-- "137 metres from the back tee" for hole 11. Migration 044's "Tee 1
-- (longest)" has hole 3 = 506m and hole 11 = 137m exactly — the club's
-- own text confirms this is the Black tee, for Champions specifically.
--
-- This is deliberately narrow: it confirms ONE tee (the longest) for
-- ONE course (Champions). It says nothing about which of the remaining
-- three columns are Blue/White/Red, and nothing about North Course's
-- equivalent tee — inferring either from this would be exactly the kind
-- of unverified extrapolation this project has consistently avoided.
-- Tee 2/3/4 (Champions) and all four tees (North) remain neutrally
-- named, unchanged.
--
-- Idempotent: a plain UPDATE matched by the existing name, safe to run
-- more than once (a second run simply finds zero rows still bearing the
-- old name and does nothing).
-- =============================================================================

UPDATE public.course_tee_sets SET name = 'Black (longest)'
WHERE name = 'Tee 1 (longest, colour unconfirmed)'
  AND course_id = (SELECT id FROM public.courses WHERE club_name = 'Sandhurst Club' AND course_name = 'Champions Course');
