-- READ-ONLY. Why do two members of the same event see different Event Chat histories?  (26 Oct field test)
-- Nothing here writes. Run each block in the Supabase SQL Editor and send me the three results.

-- 1) The READ policy actually installed. We need BOTH 'all' and 'event' to appear in the USING text.
SELECT policyname, cmd, qual
FROM pg_policies WHERE schemaname='public' AND tablename='event_messages' ORDER BY policyname;

-- 2) The stored messages for your test event (replace the name). recipient_type + sender explain who can see what.
SELECT m.created_at AT TIME ZONE 'Australia/Sydney' AS sydney_time, m.message_type, m.recipient_type,
       p.full_name AS sender, g.name AS group_name, left(m.message, 70) AS message, m.moment_id IS NOT NULL AS is_moment
FROM event_messages m
JOIN trips t ON t.id = m.trip_id
LEFT JOIN profiles p ON p.id = m.sender_user_id
LEFT JOIN trip_groups g ON g.id = m.recipient_group_id
WHERE t.name ILIKE '%YOUR EVENT NAME%'
ORDER BY m.created_at DESC LIMIT 60;

-- 3) What each person actually sees under the real policy (it errors on the placeholder until you paste a real id). Run once per person: replace the UUID with that
--    person's profile id (profiles.id). BEGIN ... ROLLBACK, nothing is changed.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'PASTE-PROFILE-UUID-HERE', true);
SELECT m.created_at AT TIME ZONE 'Australia/Sydney' AS sydney_time, m.recipient_type, left(m.message, 70) AS message
FROM event_messages m JOIN trips t ON t.id = m.trip_id
WHERE t.name ILIKE '%YOUR EVENT NAME%' ORDER BY m.created_at DESC;
ROLLBACK;
