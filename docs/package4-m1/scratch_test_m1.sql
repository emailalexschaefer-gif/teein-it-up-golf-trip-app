-- Scratch-database tests for the v2 team-score functions. Run ONLY against a throwaway database with stubbed prerequisites (auth.uid() reads app.uid).
-- Roles: each call is made as the real database role (anon / authenticated / service_role) so function privileges and RLS are exercised.
-- This does NOT prove Supabase behaviour (real JWT claims, PostgREST, default grants); that remains a separate gate.
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;   -- stands in for Supabase default grants; RLS still decides rows
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- a1 scorer, a2 team mate, a3 organiser of trip 1, a4 outsider (no trip), a5 organiser of a DIFFERENT trip, a6 plain member (not on the team)
INSERT INTO profiles (id, full_name) VALUES
 ('00000000-0000-0000-0000-0000000000a1','Scorer'),('00000000-0000-0000-0000-0000000000a2','Mate'),('00000000-0000-0000-0000-0000000000a3','Org'),
 ('00000000-0000-0000-0000-0000000000a4','Outsider'),('00000000-0000-0000-0000-0000000000a5','OtherOrg'),('00000000-0000-0000-0000-0000000000a6','Member');
INSERT INTO trips (id,name) VALUES ('10000000-0000-0000-0000-000000000001','T1'),('10000000-0000-0000-0000-000000000002','T2');
INSERT INTO trip_members (trip_id,profile_id,role) VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','member'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','member'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a3','organiser'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a6','member'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a5','organiser');
INSERT INTO rounds (id,trip_id,status) VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','active');
INSERT INTO holes (id,round_id,hole_number) VALUES ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1),('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',2);
INSERT INTO competition_teams (id,trip_id,name) VALUES ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Eagles');
-- scorer deliberately NOT confirmed yet
INSERT INTO round_team_entries (id,round_id,team_id,entry_name,nominated_scorer_id) VALUES ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Eagles','00000000-0000-0000-0000-0000000000a1');
INSERT INTO round_team_members (entry_id,round_id,player_id) VALUES ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1'),('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2');

CREATE TEMP TABLE results (n text, got text, want text);
CREATE TEMP TABLE hol AS SELECT hole_number n, id FROM holes;
-- call any function as a given DB role + user; returns 'outcome[:revision]' or 'ERR:<sqlstate>' (permission denied = 42501)
CREATE FUNCTION pg_temp.call(n text, role_ text, uid text, sql_ text, want text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r jsonb; got text;
BEGIN
  PERFORM set_config('app.uid', COALESCE(uid,''), false);
  BEGIN
    EXECUTE 'SET LOCAL ROLE ' || role_;
    EXECUTE sql_ INTO r;
    RESET ROLE;
    got := COALESCE(r->>'outcome','') || COALESCE(':'||(r->>'revision'),'');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; got := 'ERR:' || SQLSTATE;
  END;
  INSERT INTO results VALUES (n, got, want);
END $$;
CREATE FUNCTION pg_temp.sub(cid text, hole int, gross int, nr boolean, base int, reason text DEFAULT NULL, drive text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.submit_team_score(%L,%L,%L,%s,%s,%L,%s,%L)', cid, '50000000-0000-0000-0000-000000000001', (SELECT id FROM hol WHERE n=hole), COALESCE(gross::text,'NULL'), nr::text, drive, COALESCE(base::text,'NULL'), reason)
$$;
CREATE FUNCTION pg_temp.u(x text) RETURNS text LANGUAGE sql AS $$ SELECT '00000000-0000-0000-0000-0000000000' || x $$;
\set E '''50000000-0000-0000-0000-000000000001'''

-- ===== identity & privileges =====
SELECT pg_temp.call('S1 anon role cannot execute (permission denied)', 'anon', NULL, pg_temp.sub('s1',1,4,false,0), 'ERR:42501');
SELECT pg_temp.call('S2 service_role cannot execute (permission denied)', 'service_role', pg_temp.u('a3'), pg_temp.sub('s2',1,4,false,0,'x'), 'ERR:42501');
SELECT pg_temp.call('S3 authenticated with no user identity is refused', 'authenticated', NULL, pg_temp.sub('s3',1,4,false,0), 'not_authenticated');
SELECT pg_temp.call('S4 no function accepts an actor/organiser argument',  'postgres', NULL, $q$SELECT jsonb_build_object('outcome', CASE WHEN EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('submit_team_score','assign_team_scorer','release_team_override_lock','resolve_team_no_return','raise_team_score_flag','resolve_team_score_flag','waive_team_drive_requirement') AND (pg_get_function_arguments(p.oid) ILIKE '%actor%' OR pg_get_function_arguments(p.oid) ILIKE '%organiser%')) THEN 'HAS_ACTOR_ARG' ELSE 'none' END)$q$, 'none');
SELECT pg_temp.call('S5 every definer function pins search_path', 'postgres', NULL, $q$SELECT jsonb_build_object('outcome', (SELECT count(*) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prosecdef AND p.proname IN ('submit_team_score','assign_team_scorer','release_team_override_lock','resolve_team_no_return','raise_team_score_flag','resolve_team_score_flag','waive_team_drive_requirement') AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))::text)$q$, '0');

-- ===== scorer must be explicitly confirmed by the organiser =====
SELECT pg_temp.call('S6 nominated but unconfirmed scorer cannot score', 'authenticated', pg_temp.u('a1'), pg_temp.sub('c0',1,4,false,0), 'scorer_not_confirmed');
SELECT pg_temp.call('S7 cross-event organiser cannot assign the scorer', 'authenticated', pg_temp.u('a5'), format('SELECT public.assign_team_scorer(%L,%L)',:E,pg_temp.u('a1')), 'not_authorised');
SELECT pg_temp.call('S8 scorer/mate cannot assign the scorer', 'authenticated', pg_temp.u('a1'), format('SELECT public.assign_team_scorer(%L,%L)',:E,pg_temp.u('a1')), 'not_authorised');
SELECT pg_temp.call('S9 organiser cannot appoint someone outside the roster', 'authenticated', pg_temp.u('a3'), format('SELECT public.assign_team_scorer(%L,%L)',:E,pg_temp.u('a6')), 'invalid_scorer');
SELECT pg_temp.call('S10 organiser confirms the scorer', 'authenticated', pg_temp.u('a3'), format('SELECT public.assign_team_scorer(%L,%L)',:E,pg_temp.u('a1')), 'assigned');

-- ===== conflict contract (original 20 scenarios, identity now from auth.uid()) =====
SELECT pg_temp.call('1 first write', 'authenticated', pg_temp.u('a1'), pg_temp.sub('c1',1,4,false,0), 'inserted:1');
SELECT pg_temp.call('2 lost-response retry (same client_id) is idempotent', 'authenticated', pg_temp.u('a1'), pg_temp.sub('c1',1,4,false,0), 'duplicate:1');
SELECT pg_temp.call('3 normal edit on current revision', 'authenticated', pg_temp.u('a1'), pg_temp.sub('c2',1,5,false,1), 'updated:2');
SELECT pg_temp.call('4 stale offline edit with different value is NOT applied', 'authenticated', pg_temp.u('a1'), pg_temp.sub('c3',1,3,false,1), 'conflict:2');
SELECT pg_temp.call('5 stale resend of an identical value is acknowledged, not applied', 'authenticated', pg_temp.u('a1'), pg_temp.sub('c4',1,5,false,1), 'duplicate:2');
SELECT pg_temp.call('6 team mate (not the scorer) cannot write', 'authenticated', pg_temp.u('a2'), pg_temp.sub('c5',1,6,false,2), 'not_authorised');
SELECT pg_temp.call('7 organiser override needs a reason', 'authenticated', pg_temp.u('a3'), pg_temp.sub('c6',1,6,false,2), 'reason_required');
SELECT pg_temp.call('8 organiser override at current revision', 'authenticated', pg_temp.u('a3'), pg_temp.sub('c7',1,6,false,2,'Scorer misread card'), 'updated:3');
SELECT pg_temp.call('9 scorer offline edit made before the override cannot overwrite it', 'authenticated', pg_temp.u('a1'), pg_temp.sub('c8',1,4,false,2), 'locked:3');
SELECT pg_temp.call('10 scorer who has seen the override is still locked out of that hole', 'authenticated', pg_temp.u('a1'), pg_temp.sub('c9',1,4,false,3), 'locked:3');
SELECT pg_temp.call('11 organiser with a stale view is told it conflicts', 'authenticated', pg_temp.u('a3'), pg_temp.sub('c10',1,9,false,2,'x'), 'conflict:3');
SELECT pg_temp.call('12 base ahead of server is rejected', 'authenticated', pg_temp.u('a1'), pg_temp.sub('c11',2,4,false,7), 'invalid_base');
SELECT pg_temp.call('13 first write on another hole', 'authenticated', pg_temp.u('a1'), pg_temp.sub('c12',2,4,false,0), 'inserted:1');
SELECT pg_temp.call('14 pick-up recorded as No Return', 'authenticated', pg_temp.u('a1'), pg_temp.sub('c13',2,NULL,true,1), 'updated:2');
SELECT pg_temp.call('15 drive player must be on the roster', 'authenticated', pg_temp.u('a1'), pg_temp.sub('c14',2,5,false,2,NULL,pg_temp.u('a4')), 'invalid_drive_player');
SELECT pg_temp.call('16 drive player on the roster is accepted', 'authenticated', pg_temp.u('a1'), pg_temp.sub('c15',2,5,false,2,NULL,pg_temp.u('a2')), 'updated:3');
SELECT pg_temp.call('17 invalid value rejected', 'authenticated', pg_temp.u('a1'), pg_temp.sub('c16',2,25,false,3), 'invalid_value');

-- ===== cross-event / outsider =====
SELECT pg_temp.call('X1 organiser of another event cannot override', 'authenticated', pg_temp.u('a5'), pg_temp.sub('x1',1,2,false,3,'x'), 'not_authorised');
SELECT pg_temp.call('X2 outsider cannot score', 'authenticated', pg_temp.u('a4'), pg_temp.sub('x2',1,2,false,3), 'not_authorised');
SELECT pg_temp.call('X3 replaying someone elses client_id reveals nothing to an outsider', 'authenticated', pg_temp.u('a4'), pg_temp.sub('c1',1,4,false,0), 'not_authorised');

-- ===== flags =====
SELECT pg_temp.call('F1 team mate can flag', 'authenticated', pg_temp.u('a2'), format('SELECT public.raise_team_score_flag(%L,%L,%L)',:E,(SELECT id FROM hol WHERE n=1),'Looks like a 5'), 'flagged');
SELECT pg_temp.call('F2 plain trip member (not on the team) cannot flag', 'authenticated', pg_temp.u('a6'), format('SELECT public.raise_team_score_flag(%L,%L,%L)',:E,(SELECT id FROM hol WHERE n=1),'x'), 'not_authorised');
SELECT pg_temp.call('F3 outsider cannot flag', 'authenticated', pg_temp.u('a4'), format('SELECT public.raise_team_score_flag(%L,%L,%L)',:E,(SELECT id FROM hol WHERE n=1),'x'), 'not_authorised');
SELECT pg_temp.call('F4 another event''s organiser cannot flag', 'authenticated', pg_temp.u('a5'), format('SELECT public.raise_team_score_flag(%L,%L,%L)',:E,(SELECT id FROM hol WHERE n=1),'x'), 'not_authorised');
SELECT pg_temp.call('F5 a flag does not change the score', 'postgres', NULL, $q$SELECT jsonb_build_object('outcome', (SELECT gross_score::text FROM team_score_entries WHERE hole_id=(SELECT id FROM hol WHERE n=1)))$q$, '6');
SELECT pg_temp.call('F6 team mate cannot resolve a flag', 'authenticated', pg_temp.u('a2'), format('SELECT public.resolve_team_score_flag(%L,%L,%L)',(SELECT id FROM team_score_flags LIMIT 1),'resolved','x'), 'not_authorised');

-- ===== completion, No Return, unlock =====
SELECT pg_temp.call('C1 incomplete: open flag + unresolved NR + short holes', 'authenticated', pg_temp.u('a2'), format('SELECT jsonb_build_object(''outcome'', public.team_entry_completion(%L)->>''complete'')',:E), 'false');
SELECT pg_temp.call('N1 scorer cannot resolve a No Return', 'authenticated', pg_temp.u('a1'), format('SELECT public.resolve_team_no_return(%L,%L,3,%L)',:E,(SELECT id FROM hol WHERE n=2),'x'), 'not_authorised');
SELECT pg_temp.call('N2 resolve needs the hole to be a No Return', 'authenticated', pg_temp.u('a3'), format('SELECT public.resolve_team_no_return(%L,%L,3,%L)',:E,(SELECT id FROM hol WHERE n=2),'x'), 'not_no_return');
SELECT pg_temp.call('N3 scorer reverts hole 2 to NR (rev 4)', 'authenticated', pg_temp.u('a1'), pg_temp.sub('n3',2,NULL,true,3), 'updated:4');
SELECT pg_temp.call('N4 organiser resolves NR with stale view -> conflict', 'authenticated', pg_temp.u('a3'), format('SELECT public.resolve_team_no_return(%L,%L,3,%L)',:E,(SELECT id FROM hol WHERE n=2),'Per event conditions'), 'conflict:4');
SELECT pg_temp.call('N5 organiser resolves NR at current revision', 'authenticated', pg_temp.u('a3'), format('SELECT public.resolve_team_no_return(%L,%L,4,%L)',:E,(SELECT id FROM hol WHERE n=2),'Per event conditions'), 'resolved:5');
SELECT pg_temp.call('R1 non-organiser cannot release a lock', 'authenticated', pg_temp.u('a1'), format('SELECT public.release_team_override_lock(%L,%L,%L)',:E,(SELECT id FROM hol WHERE n=1),'x'), 'not_authorised');
SELECT pg_temp.call('R2 other-event organiser cannot release a lock', 'authenticated', pg_temp.u('a5'), format('SELECT public.release_team_override_lock(%L,%L,%L)',:E,(SELECT id FROM hol WHERE n=1),'x'), 'not_authorised');
SELECT pg_temp.call('R3 release needs a reason', 'authenticated', pg_temp.u('a3'), format('SELECT public.release_team_override_lock(%L,%L,NULL)',:E,(SELECT id FROM hol WHERE n=1)), 'reason_required');
SELECT pg_temp.call('R4 organiser releases the lock (revision advances)', 'authenticated', pg_temp.u('a3'), format('SELECT public.release_team_override_lock(%L,%L,%L)',:E,(SELECT id FROM hol WHERE n=1),'Let scorer continue'), 'released:4');
SELECT pg_temp.call('R5 submission queued BEFORE the override/release cannot overwrite the correction', 'authenticated', pg_temp.u('a1'), pg_temp.sub('r5',1,4,false,2), 'conflict:4');
SELECT pg_temp.call('R6 scorer who re-read the server value (base 4) can edit again', 'authenticated', pg_temp.u('a1'), pg_temp.sub('r6',1,5,false,4), 'updated:5');
SELECT pg_temp.call('R7 releasing an unlocked hole is refused', 'authenticated', pg_temp.u('a3'), format('SELECT public.release_team_override_lock(%L,%L,%L)',:E,(SELECT id FROM hol WHERE n=1),'x'), 'not_locked');

-- ===== scorer reassignment =====
SELECT pg_temp.call('A1 organiser reassigns the scorer to the team mate', 'authenticated', pg_temp.u('a3'), format('SELECT public.assign_team_scorer(%L,%L)',:E,pg_temp.u('a2')), 'assigned');
SELECT pg_temp.call('A2 previous scorer''s queued submission is refused after reassignment', 'authenticated', pg_temp.u('a1'), pg_temp.sub('a2',1,3,false,5), 'not_authorised');
SELECT pg_temp.call('A3 new scorer writes against the current revision', 'authenticated', pg_temp.u('a2'), pg_temp.sub('a3',1,4,false,5), 'updated:6');

-- ===== round close, withdrawn =====
UPDATE rounds SET status='completed';
SELECT pg_temp.call('18 scorer cannot write after the round is closed', 'authenticated', pg_temp.u('a2'), pg_temp.sub('c17',2,4,false,5), 'round_closed');
SELECT pg_temp.call('19 organiser can still correct after close (reason, current revision)', 'authenticated', pg_temp.u('a3'), pg_temp.sub('c18',2,4,false,5,'post-close fix'), 'updated:6');
UPDATE rounds SET status='active';
UPDATE round_team_entries SET status='withdrawn';
SELECT pg_temp.call('20 withdrawn entry accepts no scores', 'authenticated', pg_temp.u('a3'), pg_temp.sub('c19',1,4,false,6,'x'), 'entry_withdrawn');
UPDATE round_team_entries SET status='entered';

-- ===== RLS reads & direct writes =====
SELECT pg_temp.call('D1 member can read team scores', 'authenticated', pg_temp.u('a6'), 'SELECT jsonb_build_object(''outcome'', (SELECT count(*) FROM team_score_entries)::text)', '2');
SELECT pg_temp.call('D2 outsider reads no team scores', 'authenticated', pg_temp.u('a4'), 'SELECT jsonb_build_object(''outcome'', (SELECT count(*) FROM team_score_entries)::text)', '0');
SELECT pg_temp.call('D3 other-event organiser reads no team scores', 'authenticated', pg_temp.u('a5'), 'SELECT jsonb_build_object(''outcome'', (SELECT count(*) FROM team_score_entries)::text)', '0');
SELECT pg_temp.call('D4 team mate cannot read revision history', 'authenticated', pg_temp.u('a2'), 'SELECT jsonb_build_object(''outcome'', (SELECT count(*) FROM team_score_revisions)::text)', '0');
SELECT pg_temp.call('D5 organiser reads revision history', 'authenticated', pg_temp.u('a3'), 'SELECT jsonb_build_object(''outcome'', (SELECT (count(*)>0)::text FROM team_score_revisions))', 'true');
SELECT pg_temp.call('D6 organiser reads the audit log', 'authenticated', pg_temp.u('a3'), 'SELECT jsonb_build_object(''outcome'', (SELECT (count(*)>=4)::text FROM team_entry_audit))', 'true');
SELECT pg_temp.call('D7 team mate cannot read the audit log', 'authenticated', pg_temp.u('a2'), 'SELECT jsonb_build_object(''outcome'', (SELECT count(*) FROM team_entry_audit)::text)', '0');
SELECT pg_temp.call('D8 direct INSERT into scores denied (even for the organiser)', 'authenticated', pg_temp.u('a3'), $q$INSERT INTO team_score_entries (entry_id,hole_id,gross_score,updated_by) VALUES ('50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'00000000-0000-0000-0000-0000000000a3') RETURNING to_jsonb(1)$q$, 'ERR:42501');
SELECT pg_temp.call('D9 direct UPDATE of scores denied', 'authenticated', pg_temp.u('a2'), $q$WITH u AS (UPDATE team_score_entries SET gross_score=1 RETURNING 1) SELECT jsonb_build_object('outcome',count(*)::text) FROM u$q$, 'ERR:42501');
SELECT pg_temp.call('D10 direct UPDATE of revision history denied', 'authenticated', pg_temp.u('a3'), $q$WITH u AS (UPDATE team_score_revisions SET gross_score=1 RETURNING 1) SELECT jsonb_build_object('outcome',count(*)::text) FROM u$q$, 'ERR:42501');
SELECT pg_temp.call('D11 direct change of the scorer denied', 'authenticated', pg_temp.u('a2'), $q$WITH u AS (UPDATE round_team_entries SET nominated_scorer_id='00000000-0000-0000-0000-0000000000a2' RETURNING 1) SELECT jsonb_build_object('outcome',count(*)::text) FROM u$q$, 'ERR:42501');

SELECT n, got, want, 'FAIL' AS result FROM results WHERE got <> want;
SELECT count(*) FILTER (WHERE got <> want) AS failures, count(*) AS total FROM results;
-- history edit-proof even for the table owner; complete; cascade works
DO $$ BEGIN UPDATE team_score_revisions SET gross_score = 1; RAISE EXCEPTION 'update should have been blocked'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '%cannot be edited%' THEN RAISE NOTICE 'history edit correctly blocked'; ELSE RAISE; END IF; END $$;
SELECT r.revision, r.actor_role, r.gross_score, r.is_no_return, left(r.reason,30) reason FROM team_score_revisions r JOIN team_score_entries s ON s.id = r.team_score_id WHERE s.hole_id=(SELECT id FROM hol WHERE n=1) ORDER BY r.revision;
SELECT action, count(*) FROM team_entry_audit GROUP BY 1 ORDER BY 1;
DELETE FROM trips; SELECT (SELECT count(*) FROM team_score_revisions) AS revisions_left, (SELECT count(*) FROM team_score_entries) AS scores_left, (SELECT count(*) FROM team_entry_audit) AS audit_left;
