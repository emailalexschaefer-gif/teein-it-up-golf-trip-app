-- Behavioural test for release_round_arrangements() (migration 101).
-- Run against a scratch database that has migrations through 101 applied:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/101_release_round_arrangements.test.sql <db>
-- Everything runs in one transaction and is rolled back. Prints PASS lines; any failure aborts.
BEGIN;
SET session_replication_role = replica;   -- fixtures only: skip auth.users FK / signup triggers
DO $$
DECLARE
  org UUID := gen_random_uuid(); p1 UUID := gen_random_uuid(); p2 UUID := gen_random_uuid(); p3 UUID := gen_random_uuid();
  other_org UUID := gen_random_uuid(); stranger UUID := gen_random_uuid();
  t UUID := gen_random_uuid(); t_other UUID := gen_random_uuid();
  g1 UUID := gen_random_uuid(); g2 UUID := gen_random_uuid(); g_other UUID := gen_random_uuid();
  r1 UUID := gen_random_uuid(); r2 UUID := gen_random_uuid(); r_active UUID := gen_random_uuid(); r_cancel UUID := gen_random_uuid();
  res JSONB; n INTEGER; rows1 JSONB; rows2 JSONB;
BEGIN
  INSERT INTO profiles (id, email, full_name, handicap) VALUES
    (org,'o@x','Organiser',10),(p1,'1@x','P One',12.4),(p2,'2@x','P Two',20),(p3,'3@x','P Three',5),(other_org,'oo@x','Other Org',1),(stranger,'s@x','Stranger',1);
  INSERT INTO trips (id, organiser_id, name, start_date, end_date) VALUES (t, org, 'Lappen', current_date, current_date+2), (t_other, other_org, 'Elsewhere', current_date, current_date+2);
  INSERT INTO trip_members (trip_id, profile_id, role) VALUES (t,org,'organiser'),(t,p1,'player'),(t,p2,'player'),(t,p3,'player'),(t_other,other_org,'organiser');
  INSERT INTO trip_groups (id, trip_id, name) VALUES (g1,t,'Group 1'),(g2,t,'Group 2'),(g_other,t_other,'Group X');
  INSERT INTO rounds (id, trip_id, name, play_date, status) VALUES
    (r1,t,'Round 1',current_date,'completed'),(r2,t,'Round 2',current_date+1,'upcoming'),(r_active,t,'Round 3',current_date+2,'active'),(r_cancel,t,'Round 4',current_date+3,'cancelled');

  rows1 := jsonb_build_array(
    jsonb_build_object('player_id',p1,'group_id',g1,'group_name','Group 1','tee_time','08:00','starting_hole',1,'playing_handicap',14),
    jsonb_build_object('player_id',p2,'group_id',g1,'group_name','Group 1','tee_time','08:00','starting_hole',1,'playing_handicap',22),
    jsonb_build_object('player_id',p3,'group_id',g2,'group_name','Group 2','tee_time','08:10','starting_hole',1,'playing_handicap',3));
  rows2 := jsonb_build_array(
    jsonb_build_object('player_id',p1,'group_id',g2,'group_name','Group 2','tee_time','08:10','starting_hole',1,'playing_handicap',14),
    jsonb_build_object('player_id',p2,'group_id',g1,'group_name','Group 1','tee_time','08:00','starting_hole',1,'playing_handicap',22),
    jsonb_build_object('player_id',p3,'group_id',g2,'group_name','Group 2','tee_time','08:10','starting_hole',1,'playing_handicap',3));

  -- 1. initial release writes snapshot, revision 1, one announcement
  res := release_round_arrangements(r2, org, 0, rows1, '[]'::jsonb,
    '[{"message_type":"announcement","recipient_type":"all","message":"Round 2 arrangements are ready!"}]'::jsonb);
  ASSERT (res->>'ok')::boolean AND (res->>'revision')::int = 1, 'initial release ok: ' || res::text;
  SELECT count(*) INTO n FROM round_arrangements WHERE round_id = r2; ASSERT n = 3, 'three snapshot rows';
  ASSERT (SELECT playing_handicap FROM round_arrangements WHERE round_id=r2 AND player_id=p1) = 14, 'organiser handicap stored (profile says 12.4)';
  ASSERT (SELECT setup_released AND release_revision=1 AND released_at IS NOT NULL FROM rounds WHERE id=r2), 'round flagged released rev 1';
  ASSERT (SELECT status FROM rounds WHERE id=r2) = 'upcoming', 'release never starts the round';
  SELECT count(*) INTO n FROM scorecards WHERE round_id = r2; ASSERT n = 0, 'release creates no scorecards';
  SELECT count(*) INTO n FROM event_messages WHERE trip_id = t AND message_type='announcement'; ASSERT n = 1, 'one announcement';
  RAISE NOTICE 'PASS 1 initial release';

  -- 2. repeated request with the stale expected revision cannot release twice or duplicate the announcement
  res := release_round_arrangements(r2, org, 0, rows1, '[]'::jsonb, '[{"message_type":"announcement","recipient_type":"all","message":"dup"}]'::jsonb);
  ASSERT NOT (res->>'ok')::boolean AND res->>'error' = 'revision_conflict', 'stale revision rejected: ' || res::text;
  SELECT count(*) INTO n FROM event_messages WHERE trip_id = t; ASSERT n = 1, 'no duplicate message';
  ASSERT (SELECT release_revision FROM rounds WHERE id=r2) = 1, 'revision unchanged';
  RAISE NOTICE 'PASS 2 duplicate / racing release rejected';

  -- 3. re-release: moves p1 to group 2; only targeted player notifications; audit log; snapshot updated
  res := release_round_arrangements(r2, org, 1, rows2,
    jsonb_build_array(jsonb_build_object('player_id',p1,'changes','["group"]'::jsonb)),
    jsonb_build_array(jsonb_build_object('message_type','player_notification','recipient_type','player','recipient_user_id',p1,'message','Your arrangements changed')));
  ASSERT (res->>'ok')::boolean AND (res->>'revision')::int = 2, 're-release ok';
  ASSERT (SELECT group_id FROM round_arrangements WHERE round_id=r2 AND player_id=p1) = g2, 'snapshot group updated';
  SELECT count(*) INTO n FROM event_messages WHERE trip_id=t AND message_type='player_notification' AND recipient_user_id=p1; ASSERT n = 1, 'p1 notified';
  SELECT count(*) INTO n FROM event_messages WHERE trip_id=t AND message_type='player_notification' AND recipient_user_id<>p1; ASSERT n = 0, 'unaffected players not notified';
  SELECT count(*) INTO n FROM round_release_log WHERE round_id=r2; ASSERT n = 2, 'audit trail has both releases';
  ASSERT (SELECT kind FROM round_release_log WHERE round_id=r2 AND revision=2) = 'revision', 'log kind';
  RAISE NOTICE 'PASS 3 re-release + targeted notification + audit';

  -- 4. completed round untouched by anything above
  SELECT count(*) INTO n FROM round_arrangements WHERE round_id = r1; ASSERT n = 0, 'Round 1 has no arrangement rows';
  ASSERT (SELECT NOT setup_released AND release_revision=0 FROM rounds WHERE id=r1), 'Round 1 untouched';
  RAISE NOTICE 'PASS 4 completed round untouched';

  -- 5. active / cancelled / completed rounds cannot be released
  res := release_round_arrangements(r_active, org, 0, rows1, '[]'::jsonb, '[]'::jsonb);
  ASSERT res->>'error' = 'not_upcoming', 'active round refused';
  res := release_round_arrangements(r_cancel, org, 0, rows1, '[]'::jsonb, '[]'::jsonb);
  ASSERT res->>'error' = 'not_upcoming', 'cancelled round refused';
  res := release_round_arrangements(r1, org, 0, rows1, '[]'::jsonb, '[]'::jsonb);
  ASSERT res->>'error' = 'not_upcoming', 'completed round refused';
  RAISE NOTICE 'PASS 5 only upcoming rounds release';

  -- 6. a non-organiser (player, stranger, other event's organiser) is refused
  BEGIN PERFORM release_round_arrangements(r2, p1, 2, rows2, '[]'::jsonb, '[]'::jsonb); ASSERT false, 'player must be refused';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'NOT_ORGANISER', 'player refused: ' || SQLERRM; END;
  BEGIN PERFORM release_round_arrangements(r2, other_org, 2, rows2, '[]'::jsonb, '[]'::jsonb); ASSERT false, 'other-event organiser must be refused';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'NOT_ORGANISER', 'other organiser refused'; END;
  RAISE NOTICE 'PASS 6 organiser-only';

  -- 7. rows from another event are refused and nothing is written (all-or-nothing)
  BEGIN
    PERFORM release_round_arrangements(r2, org, 2,
      jsonb_build_array(jsonb_build_object('player_id',p1,'group_id',g_other,'group_name','X','tee_time','09:00','starting_hole',1,'playing_handicap',10)),
      '[]'::jsonb, '[{"message_type":"announcement","recipient_type":"all","message":"leak"}]'::jsonb);
    ASSERT false, 'foreign group must be refused';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'ROW_NOT_IN_EVENT', 'foreign group refused: ' || SQLERRM; END;
  SELECT count(*) INTO n FROM event_messages WHERE message = 'leak'; ASSERT n = 0, 'no message from a failed release';
  ASSERT (SELECT release_revision FROM rounds WHERE id=r2) = 2, 'revision unchanged after failed release';
  RAISE NOTICE 'PASS 7 cross-event rows refused, atomic';

  -- 8. plus handicaps (negative numbers) and large Course Handicaps are stored EXACTLY -- no golf-range check
  res := release_round_arrangements(r2, org, 2,
    jsonb_build_array(
      jsonb_build_object('player_id',p1,'group_id',g1,'group_name','G','tee_time','09:00','starting_hole',1,'playing_handicap',-4),
      jsonb_build_object('player_id',p2,'group_id',g1,'group_name','G','tee_time','09:00','starting_hole',1,'playing_handicap',-2),
      jsonb_build_object('player_id',p3,'group_id',g1,'group_name','G','tee_time','09:00','starting_hole',1,'playing_handicap',74)),
    '[]'::jsonb, '[]'::jsonb);
  ASSERT (res->>'ok')::boolean, 'plus / high handicaps release';
  ASSERT (SELECT playing_handicap FROM round_arrangements WHERE round_id=r2 AND player_id=p1) = -4, 'plus-4 stored as -4';
  ASSERT (SELECT playing_handicap FROM round_arrangements WHERE round_id=r2 AND player_id=p2) = -2, 'plus-2 stored as -2';
  ASSERT (SELECT playing_handicap FROM round_arrangements WHERE round_id=r2 AND player_id=p3) = 74, 'course handicap above 54 stored as-is';
  RAISE NOTICE 'PASS 8 plus and high handicaps stored exactly';

  -- 9. a player dropped from the arrangement set disappears from the snapshot
  res := release_round_arrangements(r2, org, 3, jsonb_build_array(jsonb_build_object('player_id',p2,'group_id',g1,'group_name','Group 1','tee_time','08:00','starting_hole',1,'playing_handicap',22)), '[]'::jsonb, '[]'::jsonb);
  SELECT count(*) INTO n FROM round_arrangements WHERE round_id=r2; ASSERT n = 1, 'withdrawn players removed from snapshot';
  RAISE NOTICE 'PASS 9 withdrawn player removed';
END $$;
ROLLBACK;
