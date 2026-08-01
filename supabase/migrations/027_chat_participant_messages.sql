-- =============================================================================
-- 027_chat_participant_messages.sql
-- =============================================================================
-- Sprint "QA & Workflow Fixes Consolidated" — Item 6: manual player chat
-- was routed entirely through the organiser-only INSERT policy, so an
-- ordinary participant sending a normal chat message was rejected before
-- it ever reached the application layer — surfacing as a generic 500,
-- not a permissions message, because the API's organiser check runs
-- first and returns its own error, but RLS would have blocked it anyway
-- for the same underlying reason.
--
-- This does NOT touch the existing organiser INSERT policy — announcements,
-- group_notification, and player_notification continue to require
-- role = 'organiser', unchanged. It ADDS a second, narrower policy: any
-- confirmed trip member may insert a message_type = 'chat_message' row
-- for recipient_type = 'group', but ONLY targeting their own group
-- (trip_members.group_id = recipient_group_id for that same user) — a
-- player cannot target a group they don't belong to, per the explicit
-- requirement. Event-wide participant chat is deliberately not enabled
-- here — there's no per-trip setting yet to control that, so only "My
-- Group" is available to ordinary participants in this pass, matching
-- "Everyone, only where enabled" with nothing enabling it yet.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

DROP POLICY IF EXISTS "Event messages: participant chat to own group" ON public.event_messages;
CREATE POLICY "Event messages: participant chat to own group" ON public.event_messages FOR INSERT
  WITH CHECK (
    sender_user_id = auth.uid()
    AND message_type = 'chat_message'
    AND recipient_type = 'group'
    AND recipient_user_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.trip_members
      WHERE trip_id = event_messages.trip_id
        AND profile_id = auth.uid()
        AND group_id = event_messages.recipient_group_id
    )
  );

NOTIFY pgrst, 'reload schema';
