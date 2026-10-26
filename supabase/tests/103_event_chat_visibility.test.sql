-- Reproduces "organiser sees the arrangements announcement, the player does not; the player sees their own Moment +
-- Longest Drive post, the organiser does not" under two stale SELECT-policy variants, then proves 103 fixes it without
-- widening group/player/cross-event/non-member access. Everything inside one rolled-back transaction.
BEGIN;
SET session_replication_role = replica;
CREATE TEMP TABLE ids AS SELECT gen_random_uuid() org, gen_random_uuid() p1, gen_random_uuid() p2, gen_random_uuid() outsider,
  gen_random_uuid() t, gen_random_uuid() t2, gen_random_uuid() g1, gen_random_uuid() g2;
GRANT SELECT ON ids TO authenticated;
INSERT INTO profiles (id,email,full_name,handicap) SELECT org,'o@x','Org',10 FROM ids UNION ALL SELECT p1,'1@x','P1',10 FROM ids UNION ALL SELECT p2,'2@x','P2',10 FROM ids UNION ALL SELECT outsider,'x@x','Out',10 FROM ids;
INSERT INTO trips (id,organiser_id,name,start_date,end_date) SELECT t,org,'T',current_date,current_date+1 FROM ids UNION ALL SELECT t2,outsider,'Other',current_date,current_date+1 FROM ids;
INSERT INTO trip_groups (id,trip_id,name) SELECT g1,t,'G1' FROM ids UNION ALL SELECT g2,t,'G2' FROM ids;
INSERT INTO trip_members (trip_id,profile_id,role,group_id) SELECT t,org,'organiser',NULL FROM ids UNION ALL SELECT t,p1,'player',g1 FROM ids UNION ALL SELECT t,p2,'player',g2 FROM ids UNION ALL SELECT t2,outsider,'organiser',NULL FROM ids;
-- event-wide posts sent by different people, stored as 'all' (what the app writes once 102 is applied)
INSERT INTO event_messages (trip_id,sender_user_id,message_type,recipient_type,message) SELECT t,org,'announcement','all','ARRANGEMENTS' FROM ids;
INSERT INTO event_messages (trip_id,sender_user_id,message_type,recipient_type,message) SELECT t,p1,'announcement','all','LONGEST DRIVE LEAD' FROM ids;
INSERT INTO event_messages (trip_id,sender_user_id,message_type,recipient_type,message) SELECT t,p1,'moment','all','PHOTO' FROM ids;
INSERT INTO event_messages (trip_id,sender_user_id,message_type,recipient_type,message) SELECT t,org,'announcement','event','LEGACY EVENT-WIDE' FROM ids;
INSERT INTO event_messages (trip_id,sender_user_id,message_type,recipient_type,recipient_group_id,message) SELECT t,p1,'chat_message','group',g1,'G1 ONLY' FROM ids;
INSERT INTO event_messages (trip_id,sender_user_id,message_type,recipient_type,recipient_user_id,message) SELECT t,org,'player_notification','player',p1,'FOR P1 ONLY' FROM ids;
INSERT INTO event_messages (trip_id,sender_user_id,message_type,recipient_type,message) SELECT t2,outsider,'announcement','all','OTHER EVENT' FROM ids;

CREATE OR REPLACE FUNCTION pg_temp.seen(uid UUID) RETURNS TEXT[] LANGUAGE plpgsql AS $f$
DECLARE r TEXT[];
BEGIN
  PERFORM set_config('request.jwt.claim.sub', uid::text, true);
  SET LOCAL ROLE authenticated;
  SELECT array_agg(message ORDER BY message) INTO r FROM event_messages;
  RESET ROLE;
  RETURN coalesce(r, ARRAY[]::TEXT[]);
END $f$;
GRANT SELECT ON event_messages, trip_members, trips, trip_groups, profiles TO authenticated;

DO $$
DECLARE o UUID; a UUID; b UUID; x UUID; s TEXT[]; variant TEXT;
BEGIN
  SELECT org,p1,p2,outsider INTO o,a,b,x FROM ids;
  FOREACH variant IN ARRAY ARRAY['all-only','event-only'] LOOP
    DROP POLICY IF EXISTS "Event messages: recipients read" ON event_messages;
    EXECUTE format($p$CREATE POLICY "Event messages: recipients read" ON event_messages FOR SELECT USING (
      is_trip_member(trip_id) AND (recipient_type = %L
        OR (recipient_type='group' AND recipient_group_id IN (SELECT group_id FROM trip_members WHERE trip_id=event_messages.trip_id AND profile_id=auth.uid()))
        OR (recipient_type='player' AND recipient_user_id=auth.uid()) OR sender_user_id=auth.uid()))$p$, CASE variant WHEN 'all-only' THEN 'all' ELSE 'event' END);
    IF variant = 'all-only' THEN
      s := pg_temp.seen(b);  -- the OTHER player, before the fix: legacy 'event' row is invisible to them, 'all' rows are visible
      ASSERT NOT ('LEGACY EVENT-WIDE' = ANY(s)), 'all-only policy hides legacy event rows';
    ELSE
      s := pg_temp.seen(b);
      ASSERT NOT ('ARRANGEMENTS' = ANY(s)) AND NOT ('LONGEST DRIVE LEAD' = ANY(s)) AND NOT ('PHOTO' = ANY(s)), 'event-only stale policy hides every all-row from non-senders (the reported symptom)';
      s := pg_temp.seen(o);  -- organiser sees only their own + legacy; misses the player's posts
      ASSERT 'ARRANGEMENTS' = ANY(s) AND NOT ('PHOTO' = ANY(s)) AND NOT ('LONGEST DRIVE LEAD' = ANY(s)), 'organiser sees own announcement but not the player posts';
      s := pg_temp.seen(a);  -- the player sees their own posts but not the organiser announcement
      ASSERT 'PHOTO' = ANY(s) AND 'LONGEST DRIVE LEAD' = ANY(s) AND NOT ('ARRANGEMENTS' = ANY(s)), 'player sees own posts but not the arrangements announcement';
      RAISE NOTICE 'PASS reproduced the field-test asymmetry with an event-only SELECT policy';
    END IF;
    -- apply migration 103 body
    DROP POLICY IF EXISTS "Event messages: recipients read" ON public.event_messages;
    CREATE POLICY "Event messages: recipients read" ON public.event_messages FOR SELECT USING (
      public.is_trip_member(trip_id) AND (recipient_type IN ('all','event')
        OR (recipient_type='group' AND recipient_group_id IN (SELECT group_id FROM public.trip_members WHERE trip_id=event_messages.trip_id AND profile_id=auth.uid()))
        OR (recipient_type='player' AND recipient_user_id=auth.uid()) OR sender_user_id=auth.uid()));
    s := pg_temp.seen(b);
    ASSERT s @> ARRAY['ARRANGEMENTS','LONGEST DRIVE LEAD','PHOTO','LEGACY EVENT-WIDE'], variant||': every member sees every event-wide post: '||s::text;
    ASSERT NOT ('G1 ONLY' = ANY(s)) AND NOT ('FOR P1 ONLY' = ANY(s)) AND NOT ('OTHER EVENT' = ANY(s)), variant||': group/player/other-event stay private';
    s := pg_temp.seen(o); ASSERT s @> ARRAY['ARRANGEMENTS','LONGEST DRIVE LEAD','PHOTO'], variant||': organiser sees player posts';
    ASSERT NOT ('OTHER EVENT' = ANY(s)), variant||': organiser never sees another event';
    s := pg_temp.seen(a); ASSERT s @> ARRAY['ARRANGEMENTS','G1 ONLY','FOR P1 ONLY'], variant||': p1 sees arrangements, own group, own notification';
    s := pg_temp.seen(x); ASSERT s = ARRAY['OTHER EVENT'], variant||': a member of another event sees only that event: '||s::text;
    RAISE NOTICE 'PASS % -> 103 gives every member the whole event-wide history and nothing private', variant;
  END LOOP;
END $$;
ROLLBACK;
