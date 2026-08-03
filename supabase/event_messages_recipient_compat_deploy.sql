-- =============================================================================
-- 029_event_messages_recipient_compat.sql
-- =============================================================================
-- Companion to the insert-level compatibility fallback in
-- messages/route.ts. If production's recipient_type CHECK constraint is
-- still the stale pre-fix version (accepting 'event' instead of 'all'),
-- an announcement insert falls back to 'event' so it can still succeed —
-- but that alone isn't enough: the existing SELECT policy only
-- recognizes 'all' as "visible to every trip member," so an 'event' row
-- would insert successfully and then be invisible to everyone except its
-- sender. This migration widens the SELECT policy to treat 'event' as
-- equivalent to 'all', so announcements are visible regardless of which
-- constraint value ended up being used.
--
-- Also widens the CHECK constraint itself to explicitly allow both
-- values going forward, so this isn't a permanent split-brain state.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

ALTER TABLE public.event_messages DROP CONSTRAINT IF EXISTS event_messages_recipient_type_check;
ALTER TABLE public.event_messages ADD CONSTRAINT event_messages_recipient_type_check
  CHECK (recipient_type IN ('all', 'event', 'group', 'player'));

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
