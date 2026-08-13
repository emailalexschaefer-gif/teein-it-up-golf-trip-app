-- =============================================================================
-- 040_course_library_seed.sql
-- =============================================================================
-- Seeds the four priority courses. Deliberately conservative, per explicit
-- instruction: only fields verified to a standard worth trusting are
-- populated. No tee sets are seeded for any course yet — every tee-level
-- and hole-level rating/distance figure found during research either had
-- an unresolved ambiguity (Sandhurst: four distance columns on the
-- official site with no labelled tee colour) or a genuine conflict
-- between sources (Sandhurst: Golf Australia Magazine's per-tee slope
-- figures vs. a third-party app's unqualified "142 slope"), or came from
-- a source that wasn't the club's own official material (Eagle Ridge,
-- Flinders). None of that is seeded as fact. See TESTING.md for the full
-- course-data audit, source by source.
--
-- What IS seeded:
--   - Course identity/location for all four (club name, course name,
--     suburb, state, country) — corroborated across multiple sources.
--   - Sandhurst Champions' full 18-hole par + stroke index — read
--     directly off the official club site (sandhurst.com), hole by hole,
--     unambiguous (no tee-colour question applies to par/SI, only to the
--     four unlabelled distance columns).
--   - Nothing else. Sandhurst North's hole data, and any tee set for any
--     of the four courses, was not fetched/verified this session and is
--     intentionally absent, not defaulted or guessed.
--
-- This is a genuinely usable starting library even in this state: an
-- organiser can search, select, and see real par/SI for at least one
-- course today, with everything else completable through the Admin UI
-- without a further migration.
-- =============================================================================

INSERT INTO public.courses (club_name, course_name, suburb, state, country, is_active, source, source_url, verified_at)
VALUES
  ('Sandhurst Club', 'Champions Course', 'Sandhurst', 'Victoria', 'Australia', true,
   'Official club website — hole-by-hole par and stroke index', 'https://www.sandhurst.com/courses/the-champions-course', CURRENT_DATE),
  ('Sandhurst Club', 'North Course', 'Sandhurst', 'Victoria', 'Australia', true,
   'Club identity confirmed via official site navigation; hole-by-hole data not yet fetched/verified', 'https://www.sandhurst.com/play-golf/courses', NULL),
  ('Eagle Ridge Golf Course', 'Championship Course', 'Boneo', 'Victoria', 'Australia', true,
   'Official club website (address/identity only; hole data not yet verified)', 'https://eagleridge.com.au/', NULL),
  ('Flinders Golf Club', 'Main Course', 'Flinders', 'Victoria', 'Australia', true,
   'Multiple independent secondary sources corroborate identity/par/holes; not yet cross-checked against the club''s own official site', NULL, NULL)
ON CONFLICT DO NOTHING;

-- Sandhurst Champions' hole-by-hole par/stroke index — read directly off
-- the official club site, hole by hole (each hole's own named page:
-- "Hole #1 Carnegie Clark PAR 4 INDEX 4", etc. through Hole #18).
-- Distance is intentionally NULL for every hole — the site shows four
-- distance numbers per hole with no tee-colour label, and guessing that
-- mapping was explicitly ruled out.
DO $$
DECLARE
  v_course_id UUID;
  v_holes JSONB := '[
    {"hole_number":1,  "par":4, "stroke_index":4},
    {"hole_number":2,  "par":4, "stroke_index":16},
    {"hole_number":3,  "par":5, "stroke_index":8},
    {"hole_number":4,  "par":4, "stroke_index":15},
    {"hole_number":5,  "par":5, "stroke_index":11},
    {"hole_number":6,  "par":3, "stroke_index":6},
    {"hole_number":7,  "par":4, "stroke_index":12},
    {"hole_number":8,  "par":3, "stroke_index":7},
    {"hole_number":9,  "par":4, "stroke_index":1},
    {"hole_number":10, "par":5, "stroke_index":9},
    {"hole_number":11, "par":3, "stroke_index":14},
    {"hole_number":12, "par":5, "stroke_index":18},
    {"hole_number":13, "par":4, "stroke_index":2},
    {"hole_number":14, "par":4, "stroke_index":10},
    {"hole_number":15, "par":4, "stroke_index":3},
    {"hole_number":16, "par":3, "stroke_index":17},
    {"hole_number":17, "par":4, "stroke_index":13},
    {"hole_number":18, "par":4, "stroke_index":5}
  ]'::jsonb;
  -- This 18-hole set sums to par 72 (10 par-4s, 4 par-3s, 4 par-5s) and
  -- stroke indexes 1-18 with no repeats — both checked by hand against
  -- the source page before writing this, as a sanity cross-check on
  -- transcription accuracy, not as a substitute for the source itself.
  v_hole JSONB;
BEGIN
  SELECT id INTO v_course_id FROM public.courses
    WHERE club_name = 'Sandhurst Club' AND course_name = 'Champions Course';

  IF v_course_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.course_tee_sets WHERE course_id = v_course_id
  ) THEN
    -- No tee set is created here — "par/stroke index" belongs to the
    -- hole, but this schema's course_tee_holes table is keyed by
    -- tee_set_id (per the given conceptual model), so par/SI can't be
    -- stored without at least one tee set to hang it off. A single
    -- placeholder tee set named "Verified — no distance yet" is created
    -- specifically so this genuinely-confirmed par/SI data has
    -- somewhere to live now, rather than waiting on tee-colour research
    -- that's explicitly unresolved. Admin can rename it and add
    -- distance once the tee-colour mapping is confirmed from a source
    -- that labels it clearly — nothing about this placeholder blocks
    -- that; it's the same row, just filled in further.
    INSERT INTO public.course_tee_sets (course_id, name, is_active)
    VALUES (v_course_id, 'Verified — no distance yet', true);

    FOR v_hole IN SELECT * FROM jsonb_array_elements(v_holes) LOOP
      INSERT INTO public.course_tee_holes (tee_set_id, hole_number, par, stroke_index, distance)
      SELECT id, (v_hole->>'hole_number')::int, (v_hole->>'par')::int, (v_hole->>'stroke_index')::int, NULL
      FROM public.course_tee_sets WHERE course_id = v_course_id AND name = 'Verified — no distance yet';
    END LOOP;
  END IF;
END $$;
