-- Field-test bug #2 reproduction. Two players, one group, 9 holes starting on hole 10.
-- (a) If production's event_messages.recipient_type CHECK is the stale pre-029 one (accepts 'event', not 'all'),
--     the initial-release announcement violates it, the WHOLE release rolls back, and the API reports a generic failure.
-- (b) With only the recipient_type CHECK widened the release succeeds on THIS scratch schema. NOTE: production also had a stale recipient_consistency_check, so the real fix is migration 102 (see 102_production_chat_constraints.test.sql).
-- One rolled-back transaction; touches nothing permanently.
BEGIN;
SET session_replication_role = replica;
DO $$
DECLARE
  org UUID := gen_random_uuid(); p1 UUID := gen_random_uuid(); t UUID := gen_random_uuid(); g1 UUID := gen_random_uuid(); r1 UUID := gen_random_uuid();
  rows JSONB; msgs JSONB; res JSONB; failed BOOLEAN := false; n INTEGER;
BEGIN
  INSERT INTO profiles (id,email,full_name,handicap) VALUES (org,'o@x','Organiser',10),(p1,'1@x','Player',12);
  INSERT INTO trips (id,organiser_id,name,start_date,end_date) VALUES (t,org,'Two player event',current_date,current_date+1);
  INSERT INTO trip_members (trip_id,profile_id,role) VALUES (t,org,'organiser'),(t,p1,'player');
  INSERT INTO trip_groups (id,trip_id,name) VALUES (g1,t,'Group 1');
  INSERT INTO rounds (id,trip_id,name,play_date,status,holes,starting_hole_number) VALUES (r1,t,'Round 1',current_date,'upcoming',9,10);
  rows := jsonb_build_array(
    jsonb_build_object('player_id',org,'group_id',g1,'group_name','Group 1','tee_time','08:00','starting_hole',10,'playing_handicap',10),
    jsonb_build_object('player_id',p1,'group_id',g1,'group_name','Group 1','tee_time','08:00','starting_hole',10,'playing_handicap',12));
  msgs := '[{"message_type":"announcement","recipient_type":"all","message":"Round 1 arrangements are ready!"}]'::jsonb;

  -- (a) stale production constraint
  ALTER TABLE event_messages DROP CONSTRAINT IF EXISTS event_messages_recipient_type_check;
  ALTER TABLE event_messages ADD CONSTRAINT event_messages_recipient_type_check CHECK (recipient_type IN ('event','group','player'));
  BEGIN
    PERFORM release_round_arrangements(r1, org, 0, rows, '[]'::jsonb, msgs);
  EXCEPTION WHEN check_violation THEN failed := true; END;
  ASSERT failed, 'stale constraint reproduces the failure (23514)';
  ASSERT (SELECT NOT setup_released AND release_revision = 0 FROM rounds WHERE id = r1), 'failed release leaves the round unreleased';
  SELECT count(*) INTO n FROM round_arrangements WHERE round_id = r1; ASSERT n = 0, 'failed release writes no snapshot (atomic)';
  RAISE NOTICE 'PASS a stale chat constraint -> release rolls back completely (the reported symptom)';

  -- (b) 029 applied
  ALTER TABLE event_messages DROP CONSTRAINT event_messages_recipient_type_check;
  ALTER TABLE event_messages ADD CONSTRAINT event_messages_recipient_type_check CHECK (recipient_type IN ('all','event','group','player'));
  res := release_round_arrangements(r1, org, 0, rows, '[]'::jsonb, msgs);
  ASSERT (res->>'ok')::boolean, 'release succeeds once the constraint allows all: ' || res::text;
  ASSERT (SELECT count(*) FROM round_arrangements WHERE round_id = r1 AND starting_hole = 10) = 2, '9-hole round starting on hole 10, two players: both stored';
  RAISE NOTICE 'PASS b 9 holes / start hole 10 / two players releases fine with the 029 constraint';
END $$;
ROLLBACK;
