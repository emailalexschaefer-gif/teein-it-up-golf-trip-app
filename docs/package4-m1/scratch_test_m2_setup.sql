-- Scratch-database tests for the organiser SETUP functions (create team, configure round, save roster, lock team handicap).
-- Run on a fresh scratch DB after /tmp/m1_prereq.sql-style stubs AND PROPOSED_104_competition_teams.sql. Not Supabase; see scratch_test_m1.sql header.
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
-- o1 organiser T1; m1..m5 members T1; x1 outsider; o2 organiser T2; q1 member of T2 only
INSERT INTO profiles (id, full_name) SELECT ('00000000-0000-0000-0000-0000000000'||k)::uuid, k FROM unnest(ARRAY['01','11','12','13','14','15','21','31','32']) k;
INSERT INTO trips (id,name) VALUES ('10000000-0000-0000-0000-000000000001','T1'),('10000000-0000-0000-0000-000000000002','T2');
INSERT INTO trip_members (trip_id,profile_id,role) VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','organiser'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','member'),('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','member'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000013','member'),('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000014','member'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000015','member'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000031','organiser'),('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000032','member');
INSERT INTO rounds (id,trip_id,status) VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','upcoming'),('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','completed');
INSERT INTO holes (id,round_id,hole_number) VALUES ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1);
INSERT INTO trip_groups (id,trip_id,name) VALUES ('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','G1'),('60000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','G2');

CREATE TEMP TABLE results (n text, got text, want text);
CREATE FUNCTION pg_temp.call(n text, role_ text, uid text, sql_ text, want text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r jsonb; got text;
BEGIN
  PERFORM set_config('app.uid', COALESCE(uid,''), false);
  BEGIN EXECUTE 'SET LOCAL ROLE ' || role_; EXECUTE sql_ INTO r; RESET ROLE; got := COALESCE(r->>'outcome','');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; got := 'ERR:' || SQLSTATE; END;
  INSERT INTO results VALUES (n, got, want);
END $$;
CREATE FUNCTION pg_temp.u(x text) RETURNS text LANGUAGE sql AS $$ SELECT '00000000-0000-0000-0000-0000000000' || x $$;
\set R1 '''20000000-0000-0000-0000-000000000001'''
\set T1 '''10000000-0000-0000-0000-000000000001'''

SELECT pg_temp.call('U1 anon cannot create a team', 'anon', NULL, format('SELECT public.create_competition_team(%L,%L)', :T1, 'A'), 'ERR:42501');
SELECT pg_temp.call('U2 service_role cannot create a team', 'service_role', pg_temp.u('01'), format('SELECT public.create_competition_team(%L,%L)', :T1, 'A'), 'ERR:42501');
SELECT pg_temp.call('U3 no identity refused', 'authenticated', NULL, format('SELECT public.create_competition_team(%L,%L)', :T1, 'A'), 'not_authenticated');
SELECT pg_temp.call('U4 plain member cannot create a team', 'authenticated', pg_temp.u('11'), format('SELECT public.create_competition_team(%L,%L)', :T1, 'A'), 'not_authorised');
SELECT pg_temp.call('U5 other event organiser cannot create a team', 'authenticated', pg_temp.u('31'), format('SELECT public.create_competition_team(%L,%L)', :T1, 'A'), 'not_authorised');
SELECT pg_temp.call('U6 organiser creates team A', 'authenticated', pg_temp.u('01'), format('SELECT public.create_competition_team(%L,%L)', :T1, 'A'), 'created');
SELECT pg_temp.call('U7 duplicate team name refused', 'authenticated', pg_temp.u('01'), format('SELECT public.create_competition_team(%L,%L)', :T1, ' a '), 'duplicate_name');
SELECT pg_temp.call('U8 organiser creates team B', 'authenticated', pg_temp.u('01'), format('SELECT public.create_competition_team(%L,%L)', :T1, 'B'), 'created');
SELECT pg_temp.call('U9 blank name refused', 'authenticated', pg_temp.u('01'), format('SELECT public.create_competition_team(%L,%L)', :T1, '  '), 'invalid_value');
SELECT pg_temp.call('U10 other event creates its own team', 'authenticated', pg_temp.u('31'), format('SELECT public.create_competition_team(%L,%L)', '10000000-0000-0000-0000-000000000002', 'Z'), 'created');
CREATE TEMP TABLE tm AS SELECT name, id FROM competition_teams;

SELECT pg_temp.call('C1 member cannot configure', 'authenticated', pg_temp.u('11'), format('SELECT public.configure_round_competition(%L,%L,%L,%L,NULL)', :R1, 'ambrose_2', 'club_divisor', '{}'), 'not_authorised');
SELECT pg_temp.call('C2 other event organiser cannot configure', 'authenticated', pg_temp.u('31'), format('SELECT public.configure_round_competition(%L,%L,%L,%L,NULL)', :R1, 'ambrose_2', 'club_divisor', '{}'), 'not_authorised');
SELECT pg_temp.call('C3 unknown format refused (three-player is not supported)', 'authenticated', pg_temp.u('01'), format('SELECT public.configure_round_competition(%L,%L,%L,%L,NULL)', :R1, 'ambrose_3', 'club_divisor', '{}'), 'invalid_value');
SELECT pg_temp.call('C4 unknown method refused', 'authenticated', pg_temp.u('01'), format('SELECT public.configure_round_competition(%L,%L,%L,%L,NULL)', :R1, 'ambrose_2', 'magic', '{}'), 'invalid_value');
SELECT pg_temp.call('C5 closed round refused', 'authenticated', pg_temp.u('01'), format('SELECT public.configure_round_competition(%L,%L,%L,%L,NULL)', '20000000-0000-0000-0000-000000000002', 'ambrose_2', 'club_divisor', '{}'), 'round_closed');
SELECT pg_temp.call('C6 entry before configuration refused', 'authenticated', pg_temp.u('01'), format('SELECT public.save_round_team_entry(%L,%L,%L)', :R1, (SELECT id FROM tm WHERE name='A'), ARRAY[pg_temp.u('11'),pg_temp.u('12')]::uuid[]), 'not_configured');
SELECT pg_temp.call('C7 organiser configures two-person weighted with drive tracking', 'authenticated', pg_temp.u('01'), format('SELECT public.configure_round_competition(%L,%L,%L,%L,4)', :R1, 'ambrose_2', 'weighted_scramble', '{}'), 'configured');

SELECT pg_temp.call('E1 member cannot save a roster', 'authenticated', pg_temp.u('11'), format('SELECT public.save_round_team_entry(%L,%L,%L)', :R1, (SELECT id FROM tm WHERE name='A'), ARRAY[pg_temp.u('11'),pg_temp.u('12')]::uuid[]), 'not_authorised');
SELECT pg_temp.call('E2 wrong team size refused', 'authenticated', pg_temp.u('01'), format('SELECT public.save_round_team_entry(%L,%L,%L)', :R1, (SELECT id FROM tm WHERE name='A'), ARRAY[pg_temp.u('11')]::uuid[]), 'wrong_team_size');
SELECT pg_temp.call('E3 same player twice refused', 'authenticated', pg_temp.u('01'), format('SELECT public.save_round_team_entry(%L,%L,%L)', :R1, (SELECT id FROM tm WHERE name='A'), ARRAY[pg_temp.u('11'),pg_temp.u('11')]::uuid[]), 'wrong_team_size');
SELECT pg_temp.call('E4 non-member of the event refused', 'authenticated', pg_temp.u('01'), format('SELECT public.save_round_team_entry(%L,%L,%L)', :R1, (SELECT id FROM tm WHERE name='A'), ARRAY[pg_temp.u('11'),pg_temp.u('32')]::uuid[]), 'not_trip_member');
SELECT pg_temp.call('E5 a team from another event refused', 'authenticated', pg_temp.u('01'), format('SELECT public.save_round_team_entry(%L,%L,%L)', :R1, (SELECT id FROM tm WHERE name='Z'), ARRAY[pg_temp.u('11'),pg_temp.u('12')]::uuid[]), 'team_not_in_event');
SELECT pg_temp.call('E6 group from another event refused', 'authenticated', pg_temp.u('01'), format('SELECT public.save_round_team_entry(%L,%L,%L,%L)', :R1, (SELECT id FROM tm WHERE name='A'), ARRAY[pg_temp.u('11'),pg_temp.u('12')]::uuid[], '60000000-0000-0000-0000-000000000002'), 'group_not_in_event');
SELECT pg_temp.call('E7 organiser saves team A roster', 'authenticated', pg_temp.u('01'), format('SELECT public.save_round_team_entry(%L,%L,%L,%L)', :R1, (SELECT id FROM tm WHERE name='A'), ARRAY[pg_temp.u('11'),pg_temp.u('12')]::uuid[], '60000000-0000-0000-0000-000000000001'), 'saved');
SELECT pg_temp.call('E8 a player cannot be in two teams in one round', 'authenticated', pg_temp.u('01'), format('SELECT public.save_round_team_entry(%L,%L,%L)', :R1, (SELECT id FROM tm WHERE name='B'), ARRAY[pg_temp.u('12'),pg_temp.u('13')]::uuid[]), 'player_in_other_team');
SELECT pg_temp.call('E9 organiser saves team B roster', 'authenticated', pg_temp.u('01'), format('SELECT public.save_round_team_entry(%L,%L,%L)', :R1, (SELECT id FROM tm WHERE name='B'), ARRAY[pg_temp.u('13'),pg_temp.u('14')]::uuid[]), 'saved');
CREATE TEMP TABLE ent AS SELECT t.name, e.id FROM round_team_entries e JOIN competition_teams t ON t.id = e.team_id;

SELECT pg_temp.call('H1 member cannot lock a handicap', 'authenticated', pg_temp.u('11'), format('SELECT public.lock_team_handicap(%L,5.2,%L::jsonb)', (SELECT id FROM ent WHERE name='A'), '{"method":"ga_weighted","players":[{"playerId":"00000000-0000-0000-0000-000000000011"},{"playerId":"00000000-0000-0000-0000-000000000012"}]}'), 'not_authorised');
SELECT pg_temp.call('H2 method must match the round configuration', 'authenticated', pg_temp.u('01'), format('SELECT public.lock_team_handicap(%L,5.2,%L::jsonb)', (SELECT id FROM ent WHERE name='A'), '{"method":"club_divisor","players":[]}'), 'method_mismatch');
SELECT pg_temp.call('H3 record roster must match the entry roster', 'authenticated', pg_temp.u('01'), format('SELECT public.lock_team_handicap(%L,5.2,%L::jsonb)', (SELECT id FROM ent WHERE name='A'), '{"method":"ga_weighted","players":[{"playerId":"00000000-0000-0000-0000-000000000011"},{"playerId":"00000000-0000-0000-0000-000000000015"}]}'), 'roster_mismatch');
SELECT pg_temp.call('H4 more than one decimal refused', 'authenticated', pg_temp.u('01'), format('SELECT public.lock_team_handicap(%L,5.25,%L::jsonb)', (SELECT id FROM ent WHERE name='A'), '{"method":"ga_weighted","players":[{"playerId":"00000000-0000-0000-0000-000000000011"},{"playerId":"00000000-0000-0000-0000-000000000012"}]}'), 'invalid_value');
SELECT pg_temp.call('H5 organiser locks the handicap snapshot', 'authenticated', pg_temp.u('01'), format('SELECT public.lock_team_handicap(%L,5.2,%L::jsonb)', (SELECT id FROM ent WHERE name='A'), '{"method":"ga_weighted","players":[{"playerId":"00000000-0000-0000-0000-000000000011"},{"playerId":"00000000-0000-0000-0000-000000000012"}]}'), 'handicap_locked');
SELECT pg_temp.call('H6 snapshot is stored', 'postgres', NULL, format('SELECT jsonb_build_object(%L, (SELECT team_handicap::text FROM round_team_entries WHERE id=%L))', 'outcome', (SELECT id FROM ent WHERE name='A')), '5.2');

-- changing a roster invalidates the handicap and un-confirms a scorer who left
SELECT pg_temp.call('R1 organiser confirms scorer m11 for team A', 'authenticated', pg_temp.u('01'), format('SELECT public.assign_team_scorer(%L,%L)', (SELECT id FROM ent WHERE name='A'), pg_temp.u('11')), 'assigned');
SELECT pg_temp.call('R2 roster change (m12 -> m15)', 'authenticated', pg_temp.u('01'), format('SELECT public.save_round_team_entry(%L,%L,%L)', :R1, (SELECT id FROM tm WHERE name='A'), ARRAY[pg_temp.u('11'),pg_temp.u('15')]::uuid[]), 'saved');
SELECT pg_temp.call('R3 handicap cleared by the roster change', 'postgres', NULL, format('SELECT jsonb_build_object(%L, (SELECT coalesce(team_handicap::text,%L) FROM round_team_entries WHERE id=%L))', 'outcome', 'cleared', (SELECT id FROM ent WHERE name='A')), 'cleared');
SELECT pg_temp.call('R4 scorer still on the roster stays confirmed', 'postgres', NULL, format('SELECT jsonb_build_object(%L, (SELECT (scorer_confirmed_at IS NOT NULL)::text FROM round_team_entries WHERE id=%L))', 'outcome', (SELECT id FROM ent WHERE name='A')), 'true');
SELECT pg_temp.call('R5 roster change dropping the scorer clears the confirmation', 'authenticated', pg_temp.u('01'), format('SELECT public.save_round_team_entry(%L,%L,%L)', :R1, (SELECT id FROM tm WHERE name='A'), ARRAY[pg_temp.u('12'),pg_temp.u('15')]::uuid[]), 'saved');
SELECT pg_temp.call('R6 scorer cleared', 'postgres', NULL, format('SELECT jsonb_build_object(%L, (SELECT (nominated_scorer_id IS NULL AND scorer_confirmed_at IS NULL)::text FROM round_team_entries WHERE id=%L))', 'outcome', (SELECT id FROM ent WHERE name='A')), 'true');

-- once scoring starts, setup is frozen
SELECT pg_temp.call('S1 organiser confirms scorer m12', 'authenticated', pg_temp.u('01'), format('SELECT public.assign_team_scorer(%L,%L)', (SELECT id FROM ent WHERE name='A'), pg_temp.u('12')), 'assigned');
UPDATE rounds SET status='active' WHERE id='20000000-0000-0000-0000-000000000001';
SELECT pg_temp.call('S2 scorer scores hole 1', 'authenticated', pg_temp.u('12'), format('SELECT public.submit_team_score(%L,%L,%L,4,false,NULL,0,NULL)', 'setup-c1', (SELECT id FROM ent WHERE name='A'), '30000000-0000-0000-0000-000000000001'), 'inserted');
SELECT pg_temp.call('S3 roster frozen after scoring starts', 'authenticated', pg_temp.u('01'), format('SELECT public.save_round_team_entry(%L,%L,%L)', :R1, (SELECT id FROM tm WHERE name='A'), ARRAY[pg_temp.u('12'),pg_temp.u('15')]::uuid[]), 'scoring_started');
SELECT pg_temp.call('S4 configuration frozen after scoring starts', 'authenticated', pg_temp.u('01'), format('SELECT public.configure_round_competition(%L,%L,%L,%L,NULL)', :R1, 'ambrose_2', 'club_divisor', '{}'), 'scoring_started');
SELECT pg_temp.call('S5 handicap frozen after scoring starts', 'authenticated', pg_temp.u('01'), format('SELECT public.lock_team_handicap(%L,5.2,%L::jsonb)', (SELECT id FROM ent WHERE name='A'), '{"method":"ga_weighted","players":[]}'), 'scoring_started');
SELECT pg_temp.call('S6 once any score exists the whole round set-up is frozen (other teams too)', 'authenticated', pg_temp.u('01'), format('SELECT public.save_round_team_entry(%L,%L,%L)', :R1, (SELECT id FROM tm WHERE name='B'), ARRAY[pg_temp.u('13'),pg_temp.u('14')]::uuid[]), 'scoring_started');
SELECT pg_temp.call('A1 setup actions are audited', 'postgres', NULL, $q$SELECT jsonb_build_object('outcome', (SELECT string_agg(action||'='||c, ',' ORDER BY action) FROM (SELECT action, count(*) c FROM team_entry_audit GROUP BY 1) x))$q$, 'entry_saved=4,handicap_locked=1,scorer_assigned=2');
SELECT pg_temp.call('D1 no direct table writes by organiser (teams)', 'authenticated', pg_temp.u('01'), $q$INSERT INTO competition_teams (trip_id,name) VALUES ('10000000-0000-0000-0000-000000000001','Sneaky') RETURNING to_jsonb(1)$q$, 'ERR:42501');


-- 28 Oct revisions: gross_only mode; No Score hole is not complete
INSERT INTO rounds (id,trip_id,status) VALUES ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','upcoming');
INSERT INTO holes (id,round_id,hole_number) VALUES ('30000000-0000-0000-0000-000000000031','20000000-0000-0000-0000-000000000003',1),('30000000-0000-0000-0000-000000000032','20000000-0000-0000-0000-000000000003',2);
\set R3 '''20000000-0000-0000-0000-000000000003'''
SELECT pg_temp.call('G1 gross_only configuration accepted', 'authenticated', pg_temp.u('01'), format('SELECT public.configure_round_competition(%L,%L,%L,%L,NULL)', :R3, 'ambrose_2', 'gross_only', '{}'), 'configured');
SELECT pg_temp.call('G2 stored mode is exactly gross_only', 'postgres', NULL, format('SELECT jsonb_build_object(%L,(SELECT handicap_method FROM round_competition_config WHERE round_id=%L))', 'outcome', :R3), 'gross_only');
SELECT pg_temp.call('G3 unknown mode refused', 'authenticated', pg_temp.u('01'), format('SELECT public.configure_round_competition(%L,%L,%L,%L,NULL)', :R3, 'ambrose_2', 'banana', '{}'), 'invalid_value');
SELECT pg_temp.call('G4 save a team in the gross-only round', 'authenticated', pg_temp.u('01'), format('SELECT public.save_round_team_entry(%L,%L,%L)', :R3, (SELECT id FROM tm WHERE name='B'), ARRAY[pg_temp.u('13'),pg_temp.u('14')]::uuid[]), 'saved');
CREATE TEMP TABLE ent3 AS SELECT e.id FROM round_team_entries e WHERE e.round_id = '20000000-0000-0000-0000-000000000003';
SELECT pg_temp.call('G5 a gross-only round has no handicap to lock', 'authenticated', pg_temp.u('01'), format('SELECT public.lock_team_handicap(%L,0.0,%L::jsonb)', (SELECT id FROM ent3), '{"method":"gross_only","players":[]}'), 'method_mismatch');
SELECT pg_temp.call('G6 confirm scorer m13', 'authenticated', pg_temp.u('01'), format('SELECT public.assign_team_scorer(%L,%L)', (SELECT id FROM ent3), pg_temp.u('13')), 'assigned');
UPDATE rounds SET status='active' WHERE id='20000000-0000-0000-0000-000000000003';
SELECT pg_temp.call('G7 scorer picks up hole 1 (No Return)', 'authenticated', pg_temp.u('13'), format('SELECT public.submit_team_score(%L,%L,%L,NULL,true,NULL,0,NULL)', 'g-c1', (SELECT id FROM ent3), '30000000-0000-0000-0000-000000000031'), 'inserted');
SELECT pg_temp.call('G8 scorer scores hole 2', 'authenticated', pg_temp.u('13'), format('SELECT public.submit_team_score(%L,%L,%L,4,false,NULL,0,NULL)', 'g-c2', (SELECT id FROM ent3), '30000000-0000-0000-0000-000000000032'), 'inserted');
SELECT pg_temp.call('G9 unresolved No Return: not complete', 'authenticated', pg_temp.u('13'), format('SELECT jsonb_build_object(''outcome'', public.team_entry_completion(%L)->>''complete'')', (SELECT id FROM ent3)), 'false');
SELECT pg_temp.call('G10 organiser records No Score', 'authenticated', pg_temp.u('01'), format('SELECT public.resolve_team_no_return(%L,%L,1,%L)', (SELECT id FROM ent3), '30000000-0000-0000-0000-000000000031', 'picked up'), 'resolved');
SELECT pg_temp.call('G11 a No Score hole is STILL not complete', 'authenticated', pg_temp.u('13'), format('SELECT jsonb_build_object(''outcome'', public.team_entry_completion(%L)->>''complete'')', (SELECT id FROM ent3)), 'false');
SELECT pg_temp.call('G12 and it is counted', 'authenticated', pg_temp.u('13'), format('SELECT jsonb_build_object(''outcome'', public.team_entry_completion(%L)->>''no_score_holes'')', (SELECT id FROM ent3)), '1');
SELECT pg_temp.call('G13 organiser applies a reasoned score: now complete', 'authenticated', pg_temp.u('01'), format('SELECT public.submit_team_score(%L,%L,%L,5,false,NULL,2,%L)', 'g-c3', (SELECT id FROM ent3), '30000000-0000-0000-0000-000000000031', 'marker confirmed'), 'updated');
SELECT pg_temp.call('G14 complete once every hole has a valid score', 'authenticated', pg_temp.u('13'), format('SELECT jsonb_build_object(''outcome'', public.team_entry_completion(%L)->>''complete'')', (SELECT id FROM ent3)), 'true');


-- Freeze boundary: locked from round release; audited reopen/relock; scorer reassignment stays available
INSERT INTO rounds (id,trip_id,status) VALUES ('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','upcoming'),('20000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','upcoming');
INSERT INTO holes (id,round_id,hole_number) VALUES ('30000000-0000-0000-0000-000000000041','20000000-0000-0000-0000-000000000004',1);
\set R4 '''20000000-0000-0000-0000-000000000004'''
\set R5 '''20000000-0000-0000-0000-000000000005'''
SELECT pg_temp.call('T0 set up round 4 before release', 'authenticated', pg_temp.u('01'), format('SELECT public.configure_round_competition(%L,%L,%L,%L,NULL)', :R4, 'ambrose_2', 'gross_only', '{}'), 'configured');
SELECT pg_temp.call('T1 save team before release', 'authenticated', pg_temp.u('01'), format('SELECT public.save_round_team_entry(%L,%L,%L)', :R4, (SELECT id FROM tm WHERE name='B'), ARRAY[pg_temp.u('13'),pg_temp.u('14')]::uuid[]), 'saved');
CREATE TEMP TABLE ent4 AS SELECT e.id FROM round_team_entries e WHERE e.round_id = '20000000-0000-0000-0000-000000000004';
SELECT pg_temp.call('T2 confirm scorer before release', 'authenticated', pg_temp.u('01'), format('SELECT public.assign_team_scorer(%L,%L)', (SELECT id FROM ent4), pg_temp.u('13')), 'assigned');
UPDATE rounds SET status='active' WHERE id='20000000-0000-0000-0000-000000000004';
SELECT pg_temp.call('T3 roster locked once the round is released', 'authenticated', pg_temp.u('01'), format('SELECT public.save_round_team_entry(%L,%L,%L)', :R4, (SELECT id FROM tm WHERE name='B'), ARRAY[pg_temp.u('13'),pg_temp.u('15')]::uuid[]), 'setup_locked');
SELECT pg_temp.call('T4 configuration locked once released', 'authenticated', pg_temp.u('01'), format('SELECT public.configure_round_competition(%L,%L,%L,%L,NULL)', :R4, 'ambrose_2', 'gross_only', '{}'), 'setup_locked');
SELECT pg_temp.call('T5 handicap locked once released', 'authenticated', pg_temp.u('01'), format('SELECT public.lock_team_handicap(%L,0.0,%L::jsonb)', (SELECT id FROM ent4), '{"method":"gross_only","players":[]}'), 'setup_locked');
SELECT pg_temp.call('T6 scorer reassignment still allowed (and audited)', 'authenticated', pg_temp.u('01'), format('SELECT public.assign_team_scorer(%L,%L)', (SELECT id FROM ent4), pg_temp.u('14')), 'assigned');
SELECT pg_temp.call('T7 a member cannot reopen set-up', 'authenticated', pg_temp.u('11'), format('SELECT public.reopen_team_setup(%L,%L)', :R4, 'please'), 'not_authorised');
SELECT pg_temp.call('T8 organiser of another event cannot reopen', 'authenticated', pg_temp.u('31'), format('SELECT public.reopen_team_setup(%L,%L)', :R4, 'please'), 'not_authorised');
SELECT pg_temp.call('T9 anon cannot reopen', 'anon', NULL, format('SELECT public.reopen_team_setup(%L,%L)', :R4, 'please'), 'ERR:42501');
SELECT pg_temp.call('T10 a reason is required', 'authenticated', pg_temp.u('01'), format('SELECT public.reopen_team_setup(%L,%L)', :R4, '   '), 'reason_required');
SELECT pg_temp.call('T11 organiser reopens with a reason', 'authenticated', pg_temp.u('01'), format('SELECT public.reopen_team_setup(%L,%L)', :R4, 'Wrong player on the team sheet'), 'reopened');
SELECT pg_temp.call('T12 reopening is audited with the reason', 'postgres', NULL, format('SELECT jsonb_build_object(%L,(SELECT count(*)::text||%L||min(reason) FROM team_entry_audit WHERE action=%L AND entry_id=%L))', 'outcome', ':', 'setup_reopened', (SELECT id FROM ent4)), '1:Wrong player on the team sheet');
SELECT pg_temp.call('T13 already reopened', 'authenticated', pg_temp.u('01'), format('SELECT public.reopen_team_setup(%L,%L)', :R4, 'again'), 'setup_not_locked');
SELECT pg_temp.call('T14 roster edit allowed while reopened', 'authenticated', pg_temp.u('01'), format('SELECT public.save_round_team_entry(%L,%L,%L)', :R4, (SELECT id FROM tm WHERE name='B'), ARRAY[pg_temp.u('13'),pg_temp.u('15')]::uuid[]), 'saved');
SELECT pg_temp.call('T15 roster change cleared the scorer who left (confirmation is explicit again)', 'postgres', NULL, format('SELECT jsonb_build_object(%L,(SELECT (nominated_scorer_id IS NULL AND scorer_confirmed_at IS NULL)::text FROM round_team_entries WHERE id=%L))', 'outcome', (SELECT id FROM ent4)), 'true');
SELECT pg_temp.call('T16 organiser relocks', 'authenticated', pg_temp.u('01'), format('SELECT public.relock_team_setup(%L)', :R4), 'relocked');
SELECT pg_temp.call('T17 locked again', 'authenticated', pg_temp.u('01'), format('SELECT public.save_round_team_entry(%L,%L,%L)', :R4, (SELECT id FROM tm WHERE name='B'), ARRAY[pg_temp.u('13'),pg_temp.u('14')]::uuid[]), 'setup_locked');
SELECT pg_temp.call('T18 relock when not reopened', 'authenticated', pg_temp.u('01'), format('SELECT public.relock_team_setup(%L)', :R4), 'setup_not_reopened');
SELECT pg_temp.call('T19 reopen again, confirm scorer, then a score exists', 'authenticated', pg_temp.u('01'), format('SELECT public.reopen_team_setup(%L,%L)', :R4, 'Second correction'), 'reopened');
SELECT pg_temp.call('T20 confirm scorer m15', 'authenticated', pg_temp.u('01'), format('SELECT public.assign_team_scorer(%L,%L)', (SELECT id FROM ent4), pg_temp.u('15')), 'assigned');
SELECT pg_temp.call('T21 scorer scores', 'authenticated', pg_temp.u('15'), format('SELECT public.submit_team_score(%L,%L,%L,4,false,NULL,0,NULL)', 'frz-1', (SELECT id FROM ent4), '30000000-0000-0000-0000-000000000041'), 'inserted');
SELECT pg_temp.call('T22 reopened set-up is strictly frozen once a score exists', 'authenticated', pg_temp.u('01'), format('SELECT public.save_round_team_entry(%L,%L,%L)', :R4, (SELECT id FROM tm WHERE name='B'), ARRAY[pg_temp.u('13'),pg_temp.u('14')]::uuid[]), 'scoring_started');
SELECT pg_temp.call('T23 relock after scoring started is still permitted (re-freezes)', 'authenticated', pg_temp.u('01'), format('SELECT public.relock_team_setup(%L)', :R4), 'relocked');
SELECT pg_temp.call('T24 reopen refused after scoring started', 'authenticated', pg_temp.u('01'), format('SELECT public.reopen_team_setup(%L,%L)', :R4, 'too late'), 'scoring_started');
SELECT pg_temp.call('T25 reopening an unreleased round is not needed', 'authenticated', pg_temp.u('01'), format('SELECT public.configure_round_competition(%L,%L,%L,%L,NULL)', :R5, 'ambrose_2', 'gross_only', '{}'), 'configured');
SELECT pg_temp.call('T26 reopen on an upcoming round', 'authenticated', pg_temp.u('01'), format('SELECT public.reopen_team_setup(%L,%L)', :R5, 'not needed'), 'setup_not_locked');
SELECT pg_temp.call('T27 the internal helper is not callable by clients', 'authenticated', pg_temp.u('01'), format('SELECT jsonb_build_object(%L, public.team_setup_block(%L))', 'outcome', :R4), 'ERR:42501');
SELECT pg_temp.call('T28 round that already has scores: reopen refused', 'authenticated', pg_temp.u('01'), format('SELECT public.reopen_team_setup(%L,%L)', :R1, 'x'), 'scoring_started');


-- Real release boundary: Confirm & Release sets rounds.setup_released only (status stays 'upcoming')
INSERT INTO rounds (id,trip_id,status) VALUES ('20000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','upcoming');
\set R6 '''20000000-0000-0000-0000-000000000006'''
SELECT pg_temp.call('U1 configure before release', 'authenticated', pg_temp.u('01'), format('SELECT public.configure_round_competition(%L,%L,%L,%L,NULL)', :R6, 'ambrose_2', 'gross_only', '{}'), 'configured');
SELECT pg_temp.call('U2 save team before release', 'authenticated', pg_temp.u('01'), format('SELECT public.save_round_team_entry(%L,%L,%L)', :R6, (SELECT id FROM tm WHERE name='B'), ARRAY[pg_temp.u('13'),pg_temp.u('14')]::uuid[]), 'saved');
UPDATE rounds SET setup_released = true WHERE id = '20000000-0000-0000-0000-000000000006';
SELECT pg_temp.call('U3 Confirm & Release alone (status still upcoming) locks the roster', 'authenticated', pg_temp.u('01'), format('SELECT public.save_round_team_entry(%L,%L,%L)', :R6, (SELECT id FROM tm WHERE name='B'), ARRAY[pg_temp.u('13'),pg_temp.u('15')]::uuid[]), 'setup_locked');
SELECT pg_temp.call('U4 release alone locks the configuration', 'authenticated', pg_temp.u('01'), format('SELECT public.configure_round_competition(%L,%L,%L,%L,NULL)', :R6, 'ambrose_4', 'gross_only', '{}'), 'setup_locked');
SELECT pg_temp.call('U5 reopen works on a released but not-started round', 'authenticated', pg_temp.u('01'), format('SELECT public.reopen_team_setup(%L,%L)', :R6, 'Swap a player'), 'reopened');
SELECT pg_temp.call('U6 edit while reopened', 'authenticated', pg_temp.u('01'), format('SELECT public.save_round_team_entry(%L,%L,%L)', :R6, (SELECT id FROM tm WHERE name='B'), ARRAY[pg_temp.u('13'),pg_temp.u('15')]::uuid[]), 'saved');
SELECT pg_temp.call('U7 relock', 'authenticated', pg_temp.u('01'), format('SELECT public.relock_team_setup(%L)', :R6), 'relocked');

SELECT n, got, want, 'FAIL' AS result FROM results WHERE got <> want;
SELECT count(*) FILTER (WHERE got <> want) AS failures, count(*) AS total FROM results;
