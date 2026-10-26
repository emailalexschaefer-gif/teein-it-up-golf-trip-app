-- 103: make the Event Chat READ policy treat recipient_type 'all' AND 'event' as "visible to every member of this event".
-- Why (26 Oct field test): once 102 let 'all' be stored, every event-wide post (release announcement, Side Game lead
-- change, everyone-audience Moment) is written as 'all'. If production's SELECT policy only recognises one of 'all' /
-- 'event' (older scripts differ), those rows are visible to their SENDER ONLY -- which is exactly the reported
-- asymmetry (organiser sees the arrangements announcement; the player sees their own photo + Longest Drive post).
-- Effect: widening only, and only to members of the SAME event (is_trip_member(trip_id) is still required).
--   unchanged: group rows only for that group's members, player rows only for the addressee, senders see their own.
--   Nothing is read, changed or deleted. Does not touch INSERT/UPDATE policies or any constraint.
-- Same policy text as migration 029's SELECT policy (029 itself must NOT be run: it would redo the constraint step).
-- Idempotent: if production already has this policy this replaces it with identical logic.
BEGIN;
DROP POLICY IF EXISTS "Event messages: recipients read" ON public.event_messages;
CREATE POLICY "Event messages: recipients read" ON public.event_messages FOR SELECT
  USING (
    public.is_trip_member(trip_id)
    AND (
      recipient_type IN ('all', 'event')
      OR (recipient_type = 'group' AND recipient_group_id IN (
        SELECT group_id FROM public.trip_members WHERE trip_id = event_messages.trip_id AND profile_id = auth.uid()
      ))
      OR (recipient_type = 'player' AND recipient_user_id = auth.uid())
      OR sender_user_id = auth.uid()
    )
  );
NOTIFY pgrst, 'reload schema';
COMMIT;
