-- Reproduces production's reported constraint state exactly (named recipient_consistency_check on 'event';
-- recipient_type_check without 'all'), proves 029 ALONE is not enough, 102 fixes the release, and existing 'event' rows survive.
BEGIN;
SET session_replication_role = replica;
DO $$
DECLARE
  org UUID := gen_random_uuid(); p1 UUID := gen_random_uuid(); t UUID := gen_random_uuid(); g1 UUID := gen_random_uuid(); r1 UUID := gen_random_uuid();
  rows JSONB; msgs JSONB; res JSONB; failed BOOLEAN := false; n INTEGER;
BEGIN
  INSERT INTO profiles (id,email,full_name,handicap) VALUES (org,'o@x','Organiser',10),(p1,'1@x','Player',12);
  INSERT INTO trips (id,organiser_id,name,start_date,end_date) VALUES (t,org,'T',current_date,current_date+1);
  INSERT INTO trip_members (trip_id,profile_id,role) VALUES (t,org,'organiser'),(t,p1,'player');
  INSERT INTO trip_groups (id,trip_id,name) VALUES (g1,t,'Group 1');
  INSERT INTO rounds (id,trip_id,name,play_date,status,holes,starting_hole_number) VALUES (r1,t,'Round 1',current_date,'upcoming',9,10);
  -- production state
  ALTER TABLE event_messages DROP CONSTRAINT IF EXISTS event_messages_check;
  ALTER TABLE event_messages DROP CONSTRAINT IF EXISTS event_messages_recipient_consistency_check;
  ALTER TABLE event_messages DROP CONSTRAINT IF EXISTS event_messages_recipient_type_check;
  ALTER TABLE event_messages ADD CONSTRAINT event_messages_recipient_type_check CHECK (recipient_type IN ('event','group','player'));
  ALTER TABLE event_messages ADD CONSTRAINT event_messages_recipient_consistency_check CHECK (
    (recipient_type='event' AND recipient_group_id IS NULL AND recipient_user_id IS NULL) OR
    (recipient_type='group' AND recipient_group_id IS NOT NULL AND recipient_user_id IS NULL) OR
    (recipient_type='player' AND recipient_user_id IS NOT NULL AND recipient_group_id IS NULL));
  INSERT INTO event_messages (trip_id,sender_user_id,message_type,recipient_type,message) VALUES (t,org,'announcement','event','existing event-wide post');
  INSERT INTO event_messages (trip_id,sender_user_id,message_type,recipient_type,recipient_group_id,message) VALUES (t,org,'chat_message','group',g1,'existing group chat');
  rows := jsonb_build_array(
    jsonb_build_object('player_id',org,'group_id',g1,'group_name','Group 1','tee_time','08:00','starting_hole',10,'playing_handicap',10),
    jsonb_build_object('player_id',p1,'group_id',g1,'group_name','Group 1','tee_time','08:00','starting_hole',10,'playing_handicap',12));
  msgs := '[{"message_type":"announcement","recipient_type":"all","message":"Round 1 arrangements are ready!"}]'::jsonb;

  -- 029's constraint change only
  ALTER TABLE event_messages DROP CONSTRAINT event_messages_recipient_type_check;
  ALTER TABLE event_messages ADD CONSTRAINT event_messages_recipient_type_check CHECK (recipient_type IN ('all','event','group','player'));
  BEGIN PERFORM release_round_arrangements(r1, org, 0, rows, '[]'::jsonb, msgs);
  EXCEPTION WHEN check_violation THEN failed := true; END;
  ASSERT failed, '029 alone still fails on the consistency check';
  RAISE NOTICE 'PASS a 029 alone does NOT fix production state';
END $$;
-- apply 102 body (without its BEGIN/COMMIT, we are inside the test transaction)
ALTER TABLE public.event_messages DROP CONSTRAINT IF EXISTS event_messages_recipient_type_check;
ALTER TABLE public.event_messages ADD CONSTRAINT event_messages_recipient_type_check CHECK (recipient_type IN ('all','event','group','player'));
ALTER TABLE public.event_messages DROP CONSTRAINT IF EXISTS event_messages_recipient_consistency_check;
ALTER TABLE public.event_messages DROP CONSTRAINT IF EXISTS event_messages_check;
ALTER TABLE public.event_messages ADD CONSTRAINT event_messages_recipient_consistency_check CHECK (
  (recipient_type IN ('all','event') AND recipient_group_id IS NULL AND recipient_user_id IS NULL) OR
  (recipient_type='group' AND recipient_group_id IS NOT NULL AND recipient_user_id IS NULL) OR
  (recipient_type='player' AND recipient_user_id IS NOT NULL AND recipient_group_id IS NULL));
DO $$
DECLARE org UUID; r1 UUID; res JSONB; n INTEGER; bad BOOLEAN := false;
BEGIN
  SELECT organiser_id, (SELECT id FROM rounds WHERE name='Round 1' ORDER BY created_at DESC LIMIT 1) INTO org, r1 FROM trips WHERE name='T' ORDER BY created_at DESC LIMIT 1;
  res := release_round_arrangements(r1, org, 0,
    (SELECT jsonb_agg(jsonb_build_object('player_id',tm.profile_id,'group_id',tg.id,'group_name','Group 1','tee_time','08:00','starting_hole',10,'playing_handicap',10))
       FROM trip_members tm, trip_groups tg WHERE tm.trip_id=(SELECT id FROM trips WHERE name='T' ORDER BY created_at DESC LIMIT 1) AND tg.trip_id=tm.trip_id),
    '[]'::jsonb, '[{"message_type":"announcement","recipient_type":"all","message":"Round 1 arrangements are ready!"}]'::jsonb);
  ASSERT (res->>'ok')::boolean, 'release succeeds after 102: ' || res::text;
  SELECT count(*) INTO n FROM event_messages WHERE message='existing event-wide post' AND recipient_type='event'; ASSERT n=1, 'existing event row untouched';
  SELECT count(*) INTO n FROM event_messages WHERE message='existing group chat' AND recipient_type='group'; ASSERT n=1, 'existing group row untouched';
  SELECT count(*) INTO n FROM event_messages WHERE recipient_type='all' AND message LIKE 'Round 1 arrangements%'; ASSERT n=1, 'exactly one announcement';
  BEGIN INSERT INTO event_messages (trip_id,sender_user_id,message_type,recipient_type,recipient_group_id,message)
        SELECT trip_id,sender_user_id,'announcement','all',gen_random_uuid(),'bad' FROM event_messages LIMIT 1;
  EXCEPTION WHEN check_violation OR foreign_key_violation THEN bad := true; END;
  ASSERT bad, 'consistency rule still rejects an all-message that carries a group id';
  RAISE NOTICE 'PASS b 102 fixes release, keeps existing rows, keeps consistency rule';
END $$;
ROLLBACK;
