-- Scenario tests for migration 100 (Finish Round Early). Run with:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/100_finish_round_early.test.sql <database with migrations 001-100 applied>
-- Everything runs inside one transaction that is ROLLED BACK; nothing is left behind.
-- Prints "PASS n: ..." for each scenario and fails loudly (non-zero exit) on the first failure.
BEGIN;
CREATE TEMP TABLE _t (n int, name text);
CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, name text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE k int;
BEGIN
  SELECT COALESCE(max(n), 0) + 1 INTO k FROM _t;
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %: %', k, name; END IF;
  INSERT INTO _t VALUES (k, name);
  RAISE NOTICE 'PASS %: %', k, name;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.fails_with(code text, stmt text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; RETURN false;
  EXCEPTION WHEN OTHERS THEN RETURN SQLERRM LIKE '%' || code || '%'; END;
END $$;

DO $$
DECLARE
  org uuid := gen_random_uuid(); trip uuid; rnd uuid; rnd2 uuid; g1 uuid; g2 uuid; g3 uuid; g4 uuid;
  names text[] := ARRAY['A','B','C','D','E','F','G','H','I','J','K'];
  p uuid[] := ARRAY[]::uuid[]; sc uuid[] := ARRAY[]::uuid[]; i int; h int; pid uuid; sid uuid; hid uuid;
  res jsonb; r record; cnt int;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (org, 'org@example.test');
  INSERT INTO public.profiles(id, email) VALUES (org, 'org@example.test') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.trips(organiser_id, name, start_date, end_date) VALUES (org, 'T', '2026-10-24', '2026-10-25') RETURNING id INTO trip;
  INSERT INTO public.trip_groups(trip_id, name) VALUES (trip, 'G1') RETURNING id INTO g1;
  INSERT INTO public.trip_groups(trip_id, name) VALUES (trip, 'G2') RETURNING id INTO g2;
  INSERT INTO public.trip_groups(trip_id, name) VALUES (trip, 'G3') RETURNING id INTO g3;
  INSERT INTO public.trip_groups(trip_id, name) VALUES (trip, 'G4') RETURNING id INTO g4;
  INSERT INTO public.rounds(trip_id, name, play_date, status, holes, start_type) VALUES (trip, 'R1', '2026-10-24', 'active', 18, 'shotgun') RETURNING id INTO rnd;
  FOR h IN 1..18 LOOP
    INSERT INTO public.holes(round_id, hole_number, par, stroke_index) VALUES (rnd, h, 4, h);
  END LOOP;
  INSERT INTO public.round_group_starting_holes(round_id, group_id, starting_hole) VALUES (rnd, g1, 1), (rnd, g2, 10), (rnd, g3, 6), (rnd, g4, 14);

  -- 11 players A..K. Groups: A,D,E,F,J,K -> G1 (start 1); B -> G2 (10); C -> G3 (6); G,H,I -> G4 (14)
  FOR i IN 1..11 LOOP
    pid := gen_random_uuid(); p := p || pid;
    INSERT INTO auth.users(id, email) VALUES (pid, 'p' || i || '@example.test');
    INSERT INTO public.profiles(id, email) VALUES (pid, 'p' || i || '@example.test') ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.trip_members(trip_id, profile_id, role, group_id)
      VALUES (trip, pid, 'player', CASE WHEN names[i] = 'B' THEN g2 WHEN names[i] = 'C' THEN g3 WHEN names[i] IN ('G','H','I') THEN g4 ELSE g1 END);
    INSERT INTO public.scorecards(round_id, player_id, playing_handicap, status) VALUES (rnd, pid, 0, CASE WHEN names[i] = 'I' THEN 'withdrawn' ELSE 'active' END) RETURNING id INTO sid;
    sc := sc || sid;
  END LOOP;

  -- score helper: gross 4 on a par 4 at handicap 0 = 2 points; pick-up = 0 points
  -- A: holes 1-9 (qualifies, start 1)
  FOR h IN 1..9 LOOP INSERT INTO public.score_entries(scorecard_id, hole_id, gross_score, entered_by, client_id, capture_role) SELECT sc[1], id, 4, org, 'a' || h, 'self' FROM public.holes WHERE round_id = rnd AND hole_number = h; END LOOP;
  -- B: holes 10-18 (qualifies, start 10)
  FOR h IN 10..18 LOOP INSERT INTO public.score_entries(scorecard_id, hole_id, gross_score, entered_by, client_id, capture_role) SELECT sc[2], id, 4, org, 'b' || h, 'self' FROM public.holes WHERE round_id = rnd AND hole_number = h; END LOOP;
  -- C: starts on 6, plays 6..14 (qualifies, start 6)
  FOR h IN 6..14 LOOP INSERT INTO public.score_entries(scorecard_id, hole_id, gross_score, entered_by, client_id, capture_role) SELECT sc[3], id, 4, org, 'c' || h, 'self' FROM public.holes WHERE round_id = rnd AND hole_number = h; END LOOP;
  -- D: 11 holes, 1..11 (qualifies; only first nine count officially, all 11 kept as actual)
  FOR h IN 1..11 LOOP INSERT INTO public.score_entries(scorecard_id, hole_id, gross_score, entered_by, client_id, capture_role) SELECT sc[4], id, 4, org, 'd' || h, 'self' FROM public.holes WHERE round_id = rnd AND hole_number = h; END LOOP;
  -- E: six holes 1..6 (incomplete)
  FOR h IN 1..6 LOOP INSERT INTO public.score_entries(scorecard_id, hole_id, gross_score, entered_by, client_id, capture_role) SELECT sc[5], id, 4, org, 'e' || h, 'self' FROM public.holes WHERE round_id = rnd AND hole_number = h; END LOOP;
  -- F: nine SCATTERED holes (1,3,5,7,9,11,13,15,17) -> must NOT qualify
  FOREACH h IN ARRAY ARRAY[1,3,5,7,9,11,13,15,17] LOOP INSERT INTO public.score_entries(scorecard_id, hole_id, gross_score, entered_by, client_id, capture_role) SELECT sc[6], id, 4, org, 'f' || h, 'self' FROM public.holes WHERE round_id = rnd AND hole_number = h; END LOOP;
  -- G: starts 14, plays 14..18 then 1..4 (wrap-around qualifies)
  FOREACH h IN ARRAY ARRAY[14,15,16,17,18,1,2,3,4] LOOP INSERT INTO public.score_entries(scorecard_id, hole_id, gross_score, entered_by, client_id, capture_role) SELECT sc[7], id, 4, org, 'g' || h, 'self' FROM public.holes WHERE round_id = rnd AND hole_number = h; END LOOP;
  -- H: starts 14, nine pick-ups in sequence (genuine qualifying ZERO)
  FOREACH h IN ARRAY ARRAY[14,15,16,17,18,1,2,3,4] LOOP INSERT INTO public.score_entries(scorecard_id, hole_id, gross_score, is_no_return, entered_by, client_id, capture_role) SELECT sc[8], id, NULL, true, org, 'h' || h, 'self' FROM public.holes WHERE round_id = rnd AND hole_number = h; END LOOP;
  -- I: withdrawn, holes 1..9 (excluded entirely)
  FOR h IN 1..9 LOOP INSERT INTO public.score_entries(scorecard_id, hole_id, gross_score, entered_by, client_id, capture_role) SELECT sc[9], id, 4, org, 'i' || h, 'self' FROM public.holes WHERE round_id = rnd AND hole_number = h; END LOOP;
  -- J: no scores at all (incomplete, 0 holes)   K: marker-only entries for 1..9 (marker rows must not count)
  FOR h IN 1..9 LOOP INSERT INTO public.score_entries(scorecard_id, hole_id, gross_score, entered_by, client_id, capture_role) SELECT sc[11], id, 4, org, 'k' || h, 'marker' FROM public.holes WHERE round_id = rnd AND hole_number = h; END LOOP;

  PERFORM pg_temp.ok((SELECT stableford_pts FROM public.score_entries WHERE client_id = 'a1') = 2, 'canonical points are untouched (gross 4 on par 4, hcp 0 = 2 pts)');

  -- ---- snapshot rules (preview) ----
  CREATE TEMP TABLE _snap AS SELECT * FROM public.round_official_snapshot(rnd, 9);
  PERFORM pg_temp.ok((SELECT count(*) FROM _snap) = 10, 'withdrawn player is excluded; 10 players in the snapshot');
  PERFORM pg_temp.ok((SELECT segment_holes FROM _snap WHERE player_id = p[1]) = ARRAY[1,2,3,4,5,6,7,8,9]::smallint[] AND (SELECT official_points FROM _snap WHERE player_id = p[1]) = 18, 'start hole 1: nine consecutive holes qualify');
  PERFORM pg_temp.ok((SELECT segment_holes FROM _snap WHERE player_id = p[2]) = ARRAY[10,11,12,13,14,15,16,17,18]::smallint[], 'shotgun start at hole 10: holes 10-18 qualify');
  PERFORM pg_temp.ok((SELECT segment_holes FROM _snap WHERE player_id = p[3]) = ARRAY[6,7,8,9,10,11,12,13,14]::smallint[] AND (SELECT start_hole FROM _snap WHERE player_id = p[3]) = 6, 'shotgun start at hole 6: holes 6-14 qualify');
  PERFORM pg_temp.ok((SELECT segment_holes FROM _snap WHERE player_id = p[7]) = ARRAY[14,15,16,17,18,1,2,3,4]::smallint[], 'shotgun start at 14 wraps around through hole 1');
  PERFORM pg_temp.ok((SELECT holes_played FROM _snap WHERE player_id = p[4]) = 11 AND (SELECT actual_points FROM _snap WHERE player_id = p[4]) = 22 AND (SELECT official_points FROM _snap WHERE player_id = p[4]) = 18, '11 holes: all 11 retained as actual (22 pts); official nine = first nine only (18 pts)');
  PERFORM pg_temp.ok((SELECT result_kind FROM _snap WHERE player_id = p[5]) = 'incomplete' AND (SELECT holes_played FROM _snap WHERE player_id = p[5]) = 6 AND (SELECT actual_points FROM _snap WHERE player_id = p[5]) = 12 AND (SELECT official_points FROM _snap WHERE player_id = p[5]) IS NULL, 'six holes: incomplete, all six scores and points retained, official points NULL (not zero)');
  PERFORM pg_temp.ok((SELECT result_kind FROM _snap WHERE player_id = p[6]) = 'incomplete' AND (SELECT holes_played FROM _snap WHERE player_id = p[6]) = 9, 'nine scattered holes do NOT qualify');
  PERFORM pg_temp.ok((SELECT result_kind FROM _snap WHERE player_id = p[8]) = 'qualifying' AND (SELECT official_points FROM _snap WHERE player_id = p[8]) = 0, 'nine pick-ups in sequence: a genuine qualifying zero (0, not NULL)');
  PERFORM pg_temp.ok((SELECT result_kind FROM _snap WHERE player_id = p[10]) = 'incomplete' AND (SELECT holes_played FROM _snap WHERE player_id = p[10]) = 0, 'no scores: incomplete with 0 holes, no fabricated entries');
  PERFORM pg_temp.ok((SELECT result_kind FROM _snap WHERE player_id = p[11]) = 'incomplete', 'marker-only entries never count as the player''s own holes');
  PERFORM pg_temp.ok(public.official_snapshot_is_mixed(rnd, 9) IS TRUE, 'groups with different nines are detected as mixed');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.score_entries se JOIN public.scorecards s ON s.id = se.scorecard_id WHERE s.round_id = rnd) = 9+9+9+11+6+9+9+9+9+9, 'previewing wrote nothing and added no score entries');

  -- ---- guards ----
  PERFORM pg_temp.ok(pg_temp.fails_with('MIXED_NINES_ACK_REQUIRED', format('SELECT public.finish_round_early(%L, %L, ''weather'', NULL, true, 9, false)', rnd, org)), 'including a mixed-nines round needs the extra confirmation');
  PERFORM pg_temp.ok((SELECT status FROM public.rounds WHERE id = rnd) = 'active' AND (SELECT count(*) FROM public.round_official_results WHERE round_id = rnd) = 0 AND (SELECT count(*) FROM public.round_early_finish_events WHERE round_id = rnd) = 0, 'failed finish is fully rolled back: round still active, no snapshot, no audit');
  PERFORM pg_temp.ok(pg_temp.fails_with('INVALID_REASON', format('SELECT public.finish_round_early(%L, %L, ''bogus'', NULL, false, 9, false)', rnd, org)), 'a valid reason is required');
  PERFORM pg_temp.ok(pg_temp.fails_with('INCLUSION_NEEDS_OFFICIAL_RESULT', format('SELECT public.finish_round_early(%L, %L, ''weather'', NULL, true, NULL, true)', rnd, org)), 'a round cannot count toward the event without an official result');

  -- ---- finish early, default exclusion ----
  res := public.finish_round_early(rnd, org, 'weather', '  Storm front  ', false, 9, false);
  PERFORM pg_temp.ok((res->>'qualifying')::int = 6 AND (res->>'incomplete')::int = 4 AND (res->>'mixed_nines')::boolean, 'finish reports 6 qualifying / 4 incomplete players and that nines were mixed');
  SELECT * INTO r FROM public.rounds WHERE id = rnd;
  PERFORM pg_temp.ok(r.status = 'completed' AND r.closed_early AND r.closed_early_reason = 'weather' AND r.closed_early_note = 'Storm front' AND r.closed_early_by = org AND r.official_holes = 9, 'round is completed (never cancelled) and records reason, note, organiser and official holes');
  PERFORM pg_temp.ok(r.counts_toward_event = false, 'championship inclusion is NO when not explicitly chosen');
  PERFORM pg_temp.ok((SELECT segment_points FROM public.round_official_results WHERE round_id = rnd AND player_id = p[4]) = ARRAY[2,2,2,2,2,2,2,2,2]::smallint[], 'the nine per-hole points are stored with the result (hole 10 and 11 of the 11-hole player are not in them)');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.round_official_results WHERE round_id = rnd) = 10 AND (SELECT count(*) FROM public.round_official_results WHERE round_id = rnd AND official_points IS NULL) = 4, 'frozen snapshot saved atomically: 10 rows, 4 with NULL official points');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.round_early_finish_events WHERE round_id = rnd AND action = 'finished_early' AND actor_id = org AND counts_toward_event = false) = 1, 'one audit event recorded');
  PERFORM pg_temp.ok(pg_temp.fails_with('ROUND_NOT_ACTIVE', format('SELECT public.finish_round_early(%L, %L, ''weather'', NULL, false, 9, false)', rnd, org)), 'a repeated request cannot finish the round twice');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.round_official_results WHERE round_id = rnd) = 10 AND (SELECT count(*) FROM public.round_early_finish_events WHERE round_id = rnd) = 1, 'repeat request created no duplicate results or audit rows');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.score_entries se JOIN public.scorecards s ON s.id = se.scorecard_id WHERE s.round_id = rnd) = 9+9+9+11+6+9+9+9+9+9, 'finishing early wrote no score entries (no fake zeros or pick-ups)');

  -- ---- explicit inclusion is audited, needs confirmation, can be changed back ----
  PERFORM pg_temp.ok(pg_temp.fails_with('MIXED_NINES_ACK_REQUIRED', format('SELECT public.set_round_early_inclusion(%L, %L, true, false)', rnd, org)), 'inclusion of mixed nines needs confirmation');
  PERFORM public.set_round_early_inclusion(rnd, org, true, true);
  PERFORM pg_temp.ok((SELECT counts_toward_event FROM public.rounds WHERE id = rnd) AND (SELECT mixed_nines_acknowledged FROM public.round_early_finish_events WHERE round_id = rnd AND action = 'inclusion_changed'), 'explicit inclusion recorded, with the mixed-nines acknowledgement, in the audit trail');
  PERFORM pg_temp.ok(pg_temp.fails_with('INCLUSION_UNCHANGED', format('SELECT public.set_round_early_inclusion(%L, %L, true, true)', rnd, org)), 'no-op inclusion changes are rejected');
  PERFORM public.set_round_early_inclusion(rnd, org, false, false);
  PERFORM pg_temp.ok(NOT (SELECT counts_toward_event FROM public.rounds WHERE id = rnd), 'inclusion can be switched back off');

  -- ---- score correction after the freeze, then audited refresh ----
  INSERT INTO public.score_entries(scorecard_id, hole_id, gross_score, entered_by, client_id, capture_role)
    SELECT sc[5], id, 4, org, 'e-late' || hole_number, 'self' FROM public.holes WHERE round_id = rnd AND hole_number IN (7, 8, 9);
  PERFORM pg_temp.ok((SELECT result_kind FROM public.round_official_results WHERE round_id = rnd AND player_id = p[5]) = 'incomplete', 'results stay frozen after a later score correction (never silently recalculated)');
  PERFORM pg_temp.ok((SELECT result_kind FROM public.round_official_snapshot(rnd, 9) WHERE player_id = p[5]) = 'qualifying', 'the live comparison shows the snapshot is now out of date');
  res := public.refresh_round_official_results(rnd, org);
  PERFORM pg_temp.ok((res->>'changed')::int = 1 AND (SELECT official_points FROM public.round_official_results WHERE round_id = rnd AND player_id = p[5]) = 18, 'refresh updates exactly the changed player');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.round_official_results WHERE round_id = rnd) = 10 AND (SELECT count(*) FROM public.round_early_finish_events WHERE round_id = rnd AND action = 'results_refreshed') = 1, 'refresh creates no duplicate rows and records one audit event');
  res := public.refresh_round_official_results(rnd, org);
  PERFORM pg_temp.ok((res->>'changed')::int = 0, 'refreshing twice does not double count anything');

  -- ---- shape constraints: the database itself separates incomplete from zero ----
  PERFORM pg_temp.ok(pg_temp.fails_with('round_official_results_shape', format('UPDATE public.round_official_results SET official_points = 5 WHERE round_id = %L AND result_kind = ''incomplete''', rnd)), 'an incomplete result can never carry points');
  PERFORM pg_temp.ok(pg_temp.fails_with('round_official_results_shape', format('UPDATE public.round_official_results SET official_points = NULL WHERE round_id = %L AND result_kind = ''qualifying''', rnd)), 'a qualifying result can never lose its points (zero stays zero)');
  PERFORM pg_temp.ok(pg_temp.fails_with('round_official_results_shape', format('UPDATE public.round_official_results SET segment_holes = ARRAY[1,1,1,1,1,1,1,1,1]::smallint[] WHERE round_id = %L AND player_id = %L', rnd, p[1])), 'a segment must be nine DISTINCT holes');
  PERFORM pg_temp.ok(pg_temp.fails_with('round_official_results_shape', format('UPDATE public.round_official_results SET segment_holes = ARRAY[1,2,3,4,5,6,7,8]::smallint[] WHERE round_id = %L AND player_id = %L', rnd, p[1])), 'a segment must be exactly nine holes');
  PERFORM pg_temp.ok(pg_temp.fails_with('round_official_results_shape', format('UPDATE public.round_official_results SET official_points = official_points + 1 WHERE round_id = %L AND player_id = %L', rnd, p[1])), 'official points must equal the sum of the nine stored hole points');
  PERFORM pg_temp.ok(pg_temp.fails_with('round_official_results_unique', format('INSERT INTO public.round_official_results SELECT gen_random_uuid(), round_id, player_id, scorecard_id, result_kind, start_hole, holes_played, actual_points, playing_handicap, segment_holes, segment_points, official_points, now(), computed_by FROM public.round_official_results WHERE round_id = %L LIMIT 1', rnd)), 'duplicate player results for a round are impossible');
  INSERT INTO public.rounds(trip_id, name, play_date, status, holes) VALUES (trip, 'R2', '2026-10-25', 'completed', 9) RETURNING id INTO rnd2;
  PERFORM pg_temp.ok(pg_temp.fails_with('rounds_closed_early_consistent', format('UPDATE public.rounds SET counts_toward_event = false WHERE id = %L', (SELECT id FROM public.rounds WHERE trip_id = trip AND NOT closed_early LIMIT 1))), 'a normal round can never be excluded from the event');

  -- ---- normal rounds are untouched ----
  PERFORM pg_temp.ok((SELECT NOT closed_early AND counts_toward_event AND official_holes IS NULL FROM public.rounds WHERE id = rnd2), 'a normal completed round keeps current behaviour (counts, no early-finish data)');
  PERFORM pg_temp.ok(pg_temp.fails_with('ROUND_NOT_ACTIVE', format('SELECT public.finish_round_early(%L, %L, ''weather'', NULL, false, 9, false)', rnd2, org)), 'a completed round cannot be finished early');
  INSERT INTO public.rounds(trip_id, name, play_date, status, holes) VALUES (trip, 'R3', '2026-10-26', 'upcoming', 18) RETURNING id INTO rnd2;
  PERFORM pg_temp.ok(pg_temp.fails_with('ROUND_NOT_ACTIVE', format('SELECT public.finish_round_early(%L, %L, ''weather'', NULL, false, 9, false)', rnd2, org)), 'an upcoming round is cancelled, not finished early');
  INSERT INTO public.rounds(trip_id, name, play_date, status, holes) VALUES (trip, 'R4', '2026-10-27', 'cancelled', 18);
  PERFORM pg_temp.ok((SELECT count(*) FROM public.rounds WHERE trip_id = trip AND status = 'cancelled') = 1 AND (SELECT NOT closed_early FROM public.rounds WHERE trip_id = trip AND status = 'cancelled'), 'cancelled rounds stay cancelled and separate');
END $$;

SELECT count(*) AS scenarios_passed FROM _t;
ROLLBACK;
