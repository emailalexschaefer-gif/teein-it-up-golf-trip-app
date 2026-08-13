-- =============================================================================
-- 044_course_library_data_population.sql
-- =============================================================================
-- Course Library v1 — data population only. No schema changes, no
-- application code, no changes to trips/rounds/library_holes_snapshot/
-- side competitions/scoring/handicap logic. This migration only inserts
-- and upserts rows into courses/course_tee_sets/course_tee_holes.
--
-- Idempotent throughout: every INSERT uses ON CONFLICT against the
-- schema's own existing unique constraints (courses has none beyond its
-- primary key, matched here by club_name+course_name; course_tee_sets
-- is UNIQUE(course_id, name); course_tee_holes is UNIQUE(tee_set_id,
-- hole_number)) — running this migration twice updates the same rows
-- in place, never creates duplicates.
--
-- ── Sandhurst Champions & North — a genuine, unresolved limitation ────────
-- The official Sandhurst site (sandhurst.com) shows FOUR distance
-- figures per hole with NO tee-colour label anywhere on the page. Per
-- explicit instruction, this migration does not invent that mapping.
-- Four tee_sets are created per course, named by column position
-- ("Tee 1" = longest ... "Tee 4" = shortest), each holding par + stroke
-- index (identical across all four at both courses — the official page
-- shows one par/index per hole, not four) and that column's own
-- distance. Champions' par/stroke index were already seeded in
-- migration 040 under a single placeholder tee set — that row is
-- updated in place here (renamed, distance added) rather than left
-- behind as a stale duplicate.
--
-- Cross-check: Sandhurst North's "Tee 1" (longest) column sums to
-- exactly 6,478m, matching the official site's own stated "6,478 metres
-- from the championship markers" figure — strong independent
-- confirmation this is both the correct transcription and genuinely the
-- longest/championship tee, even without a colour name for it.
--
-- ── Flinders — one real data discrepancy, resolved by not resolving it ────
-- The Men's Black tee's 18 individual hole distances (as supplied,
-- transcribed from the official scorecard) sum to 5,307m. The same
-- source's own stated total is 5,277m — a 30m discrepancy. Rather than
-- store both a total and a set of holes that contradict each other,
-- the verified per-hole distances are kept and total_distance is left
-- NULL, with the tee set's own name flagging this directly (visible
-- everywhere it's shown, not just in the course's source field) — no
-- guess at which figure is the error, since neither source states one.
--
-- ── Eagle Ridge — deliberately untouched by this migration ────────────────
-- Every source found (Chronogolf, GolfNow, GolfPass) is third-party and
-- they disagree with each other on rating/slope/distance for the same
-- named tees. No official club scorecard was found. Left exactly as
-- migration 040 seeded it — identity/address only, no tee sets.
-- =============================================================================

-- ── Course-level source metadata refresh ─────────────────────────────────────
UPDATE public.courses SET
  source = 'Official club website — full 18-hole par, stroke index, and four distance measurements per hole (tee-colour mapping not established by the source)',
  source_url = 'https://www.sandhurst.com/courses/the-champions-course',
  verified_at = CURRENT_DATE
WHERE club_name = 'Sandhurst Club' AND course_name = 'Champions Course';

UPDATE public.courses SET
  source = 'Official club website — full 18-hole par, stroke index, and four distance measurements per hole (tee-colour mapping not established by the source; "Tee 1" distance total of 6,478m independently matches the site''s own stated championship-tee total)',
  source_url = 'https://www.sandhurst.com/courses/the-north-course',
  verified_at = CURRENT_DATE
WHERE club_name = 'Sandhurst Club' AND course_name = 'North Course';

UPDATE public.courses SET
  source = 'Official club scorecard — Men''s Black tee verified hole-by-hole (par, stroke index, distance). NOTE: hole-by-hole distances sum to 5,307m; the same source states a 5,277m total — a 30m discrepancy. Per-hole distances are stored as verified; the tee set''s total_distance is left NULL rather than storing a total that contradicts its own rows, and the tee set name itself flags this. Check against the live scorecard to resolve.',
  source_url = 'https://www.flindersgolfclub.com.au/cms/golf/scorecard/',
  verified_at = CURRENT_DATE
WHERE club_name = 'Flinders Golf Club' AND course_name = 'Main Course';

-- ── Sandhurst Champions ───────────────────────────────────────────────────────
DO $$
DECLARE
  v_course_id UUID;
  v_holes JSONB := '[
    {"hole_number":1,  "par":4, "si":4,  "d":[376,366,345,334]},
    {"hole_number":2,  "par":4, "si":16, "d":[315,301,284,246]},
    {"hole_number":3,  "par":5, "si":8,  "d":[506,469,446,414]},
    {"hole_number":4,  "par":4, "si":15, "d":[337,296,279,259]},
    {"hole_number":5,  "par":5, "si":11, "d":[487,454,441,381]},
    {"hole_number":6,  "par":3, "si":6,  "d":[195,157,144,125]},
    {"hole_number":7,  "par":4, "si":12, "d":[340,328,314,295]},
    {"hole_number":8,  "par":3, "si":7,  "d":[178,163,151,148]},
    {"hole_number":9,  "par":4, "si":1,  "d":[412,386,377,377]},
    {"hole_number":10, "par":5, "si":9,  "d":[498,478,468,419]},
    {"hole_number":11, "par":3, "si":14, "d":[137,130,119,97]},
    {"hole_number":12, "par":5, "si":18, "d":[456,428,418,389]},
    {"hole_number":13, "par":4, "si":2,  "d":[396,374,358,336]},
    {"hole_number":14, "par":4, "si":10, "d":[357,335,326,302]},
    {"hole_number":15, "par":4, "si":3,  "d":[374,352,342,317]},
    {"hole_number":16, "par":3, "si":17, "d":[160,133,123,113]},
    {"hole_number":17, "par":4, "si":13, "d":[330,305,289,268]},
    {"hole_number":18, "par":4, "si":5,  "d":[428,396,378,350]}
  ]'::jsonb;
  -- Verified by hand before writing: par sums to 72 (10x par-4, 4x
  -- par-3, 4x par-5), stroke indexes are a complete 1-18 set with no
  -- repeats, all four distance columns sum to 6282/5851/5602/5170m
  -- respectively — no total published for Champions specifically (the
  -- North Course's own published total was the cross-check available;
  -- Champions has no equivalent single published figure found).
  v_hole JSONB;
  v_tee  INTEGER;
  v_tee_id UUID;
BEGIN
  SELECT id INTO v_course_id FROM public.courses
    WHERE club_name = 'Sandhurst Club' AND course_name = 'Champions Course';
  IF v_course_id IS NULL THEN RETURN; END IF;

  -- The migration-040 placeholder becomes "Tee 1" in place, rather than
  -- being left behind as a stale, now-inaccurately-named duplicate row.
  UPDATE public.course_tee_sets SET name = 'Tee 1 (longest, colour unconfirmed)'
    WHERE course_id = v_course_id AND name = 'Verified — no distance yet';

  FOR v_tee IN 1..4 LOOP
    INSERT INTO public.course_tee_sets (course_id, name, is_active)
    VALUES (
      v_course_id,
      CASE v_tee WHEN 1 THEN 'Tee 1 (longest, colour unconfirmed)'
                 WHEN 4 THEN 'Tee 4 (shortest, colour unconfirmed)'
                 ELSE 'Tee ' || v_tee || ' (colour unconfirmed)' END,
      true
    )
    ON CONFLICT (course_id, name) DO NOTHING;

    SELECT id INTO v_tee_id FROM public.course_tee_sets
      WHERE course_id = v_course_id AND name = (
        CASE v_tee WHEN 1 THEN 'Tee 1 (longest, colour unconfirmed)'
                   WHEN 4 THEN 'Tee 4 (shortest, colour unconfirmed)'
                   ELSE 'Tee ' || v_tee || ' (colour unconfirmed)' END
      );

    FOR v_hole IN SELECT * FROM jsonb_array_elements(v_holes) LOOP
      INSERT INTO public.course_tee_holes (tee_set_id, hole_number, par, stroke_index, distance)
      VALUES (
        v_tee_id, (v_hole->>'hole_number')::int, (v_hole->>'par')::int, (v_hole->>'si')::int,
        (v_hole->'d'->>(v_tee - 1))::int
      )
      ON CONFLICT (tee_set_id, hole_number) DO UPDATE
        SET par = EXCLUDED.par, stroke_index = EXCLUDED.stroke_index, distance = EXCLUDED.distance;
    END LOOP;

    -- Total distance on the tee set itself, computed from the same
    -- verified per-hole figures just written — never a separately
    -- transcribed number that could silently disagree with its own holes.
    UPDATE public.course_tee_sets SET
      par = 72, total_distance = (SELECT SUM(distance) FROM public.course_tee_holes WHERE tee_set_id = v_tee_id)
      WHERE id = v_tee_id;
  END LOOP;
END $$;

-- ── Sandhurst North ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_course_id UUID;
  v_holes JSONB := '[
    {"hole_number":1,  "par":4, "si":17, "d":[366,318,305,292]},
    {"hole_number":2,  "par":4, "si":3,  "d":[406,393,380,335]},
    {"hole_number":3,  "par":3, "si":14, "d":[181,162,153,131]},
    {"hole_number":4,  "par":5, "si":9,  "d":[517,497,485,417]},
    {"hole_number":5,  "par":4, "si":4,  "d":[388,370,341,316]},
    {"hole_number":6,  "par":4, "si":1,  "d":[418,385,372,344]},
    {"hole_number":7,  "par":4, "si":10, "d":[374,347,335,305]},
    {"hole_number":8,  "par":3, "si":12, "d":[173,159,151,141]},
    {"hole_number":9,  "par":5, "si":7,  "d":[512,487,479,451]},
    {"hole_number":10, "par":4, "si":6,  "d":[375,357,345,317]},
    {"hole_number":11, "par":5, "si":13, "d":[497,482,458,424]},
    {"hole_number":12, "par":4, "si":2,  "d":[391,375,365,330]},
    {"hole_number":13, "par":3, "si":18, "d":[137,128,112,104]},
    {"hole_number":14, "par":4, "si":16, "d":[321,277,270,224]},
    {"hole_number":15, "par":3, "si":8,  "d":[178,171,165,152]},
    {"hole_number":16, "par":4, "si":15, "d":[324,305,298,255]},
    {"hole_number":17, "par":5, "si":11, "d":[528,515,493,450]},
    {"hole_number":18, "par":4, "si":5,  "d":[392,361,349,317]}
  ]'::jsonb;
  -- Verified by hand: par sums to 72, stroke indexes complete 1-18 with
  -- no repeats. "Tee 1" column sums to 6,478m, exactly matching the
  -- official site's own stated "6,478 metres from the championship
  -- markers" — the strongest cross-check available for any of this
  -- session's data, independently confirming both the transcription and
  -- that this is genuinely the longest/championship tee.
  v_hole JSONB;
  v_tee  INTEGER;
  v_tee_id UUID;
BEGIN
  SELECT id INTO v_course_id FROM public.courses
    WHERE club_name = 'Sandhurst Club' AND course_name = 'North Course';
  IF v_course_id IS NULL THEN RETURN; END IF;

  FOR v_tee IN 1..4 LOOP
    INSERT INTO public.course_tee_sets (course_id, name, is_active)
    VALUES (
      v_course_id,
      CASE v_tee WHEN 1 THEN 'Tee 1 (longest, colour unconfirmed)'
                 WHEN 4 THEN 'Tee 4 (shortest, colour unconfirmed)'
                 ELSE 'Tee ' || v_tee || ' (colour unconfirmed)' END,
      true
    )
    ON CONFLICT (course_id, name) DO NOTHING;

    SELECT id INTO v_tee_id FROM public.course_tee_sets
      WHERE course_id = v_course_id AND name = (
        CASE v_tee WHEN 1 THEN 'Tee 1 (longest, colour unconfirmed)'
                   WHEN 4 THEN 'Tee 4 (shortest, colour unconfirmed)'
                   ELSE 'Tee ' || v_tee || ' (colour unconfirmed)' END
      );

    FOR v_hole IN SELECT * FROM jsonb_array_elements(v_holes) LOOP
      INSERT INTO public.course_tee_holes (tee_set_id, hole_number, par, stroke_index, distance)
      VALUES (
        v_tee_id, (v_hole->>'hole_number')::int, (v_hole->>'par')::int, (v_hole->>'si')::int,
        (v_hole->'d'->>(v_tee - 1))::int
      )
      ON CONFLICT (tee_set_id, hole_number) DO UPDATE
        SET par = EXCLUDED.par, stroke_index = EXCLUDED.stroke_index, distance = EXCLUDED.distance;
    END LOOP;

    UPDATE public.course_tee_sets SET
      par = 72, total_distance = (SELECT SUM(distance) FROM public.course_tee_holes WHERE tee_set_id = v_tee_id)
      WHERE id = v_tee_id;
  END LOOP;
END $$;

-- ── Flinders Golf Club — Men's Black (the one unambiguous, officially-
--    labelled tee among all data supplied this round) ───────────────────────
DO $$
DECLARE
  v_course_id UUID;
  v_holes JSONB := '[
    {"hole_number":1,  "par":4, "si":18, "distance":234},
    {"hole_number":2,  "par":4, "si":4,  "distance":304},
    {"hole_number":3,  "par":3, "si":10, "distance":195},
    {"hole_number":4,  "par":4, "si":15, "distance":272},
    {"hole_number":5,  "par":5, "si":8,  "distance":458},
    {"hole_number":6,  "par":4, "si":1,  "distance":385},
    {"hole_number":7,  "par":4, "si":2,  "distance":404},
    {"hole_number":8,  "par":4, "si":7,  "distance":350},
    {"hole_number":9,  "par":3, "si":13, "distance":174},
    {"hole_number":10, "par":4, "si":9,  "distance":344},
    {"hole_number":11, "par":4, "si":17, "distance":260},
    {"hole_number":12, "par":3, "si":16, "distance":140},
    {"hole_number":13, "par":4, "si":3,  "distance":347},
    {"hole_number":14, "par":3, "si":12, "distance":153},
    {"hole_number":15, "par":5, "si":5,  "distance":495},
    {"hole_number":16, "par":4, "si":14, "distance":305},
    {"hole_number":17, "par":3, "si":11, "distance":172},
    {"hole_number":18, "par":4, "si":6,  "distance":315}
  ]'::jsonb;
  -- Verified by hand: par sums to 69, stroke indexes complete 1-18 with
  -- no repeats. Distances as supplied sum to 5,307m — the source's own
  -- stated total is 5,277m, a 30m discrepancy. Per explicit instruction,
  -- this is NOT resolved by picking one figure as authoritative: the
  -- verified per-hole distances are kept (each one individually
  -- transcribed from the scorecard, not itself in question), but
  -- total_distance is left NULL rather than storing a published total
  -- that contradicts the sum of the very rows sitting next to it in the
  -- same table. Two contradictory "truths" is worse than one honest
  -- gap. The tee set's own name also carries this flag directly,
  -- visible everywhere it's shown (Admin UI, organiser tee selection),
  -- not only in the course's own source field.
  v_hole JSONB;
  v_tee_id UUID;
BEGIN
  SELECT id INTO v_course_id FROM public.courses
    WHERE club_name = 'Flinders Golf Club' AND course_name = 'Main Course';
  IF v_course_id IS NULL THEN RETURN; END IF;

  INSERT INTO public.course_tee_sets (course_id, name, gender, par, total_distance, course_rating, slope_rating, is_active)
  VALUES (v_course_id, 'Men''s Black (total distance unverified — see note)', 'Men''s', 69, NULL, 69.0, 125, true)
  ON CONFLICT (course_id, name) DO UPDATE
    SET gender = EXCLUDED.gender, par = EXCLUDED.par, total_distance = EXCLUDED.total_distance,
        course_rating = EXCLUDED.course_rating, slope_rating = EXCLUDED.slope_rating;

  SELECT id INTO v_tee_id FROM public.course_tee_sets WHERE course_id = v_course_id AND name = 'Men''s Black (total distance unverified — see note)';

  FOR v_hole IN SELECT * FROM jsonb_array_elements(v_holes) LOOP
    INSERT INTO public.course_tee_holes (tee_set_id, hole_number, par, stroke_index, distance)
    VALUES (v_tee_id, (v_hole->>'hole_number')::int, (v_hole->>'par')::int, (v_hole->>'si')::int, (v_hole->>'distance')::int)
    ON CONFLICT (tee_set_id, hole_number) DO UPDATE
      SET par = EXCLUDED.par, stroke_index = EXCLUDED.stroke_index, distance = EXCLUDED.distance;
  END LOOP;
END $$;
