-- =============================================================================
-- 031_public_event_posts.sql
-- =============================================================================
-- Sprint 6.1 Package 3 — players need a way to post socially to everyone
-- in the event, not just their own group (a "Public Event Post" — social,
-- from a player or organiser, explicitly NOT an official announcement).
-- Migration 027 deliberately left this disabled ("no per-trip setting
-- exists yet to enable this"); this migration is that enabling step,
-- superseding that earlier reasoning now that it's an explicit
-- requirement rather than a deferred one.
--
-- Widens the existing participant-chat INSERT policy: any confirmed trip
-- member may now send message_type = 'chat_message' to either their own
-- group (unchanged from 027) OR recipient_type IN ('all', 'event') —
-- event-wide, no group-ownership check needed since it's visible to
-- everyone anyway. This does NOT touch the organiser-only policy for
-- announcement/group_notification/player_notification — those remain
-- exactly as restricted as before. The distinction that matters is
-- message_type ('chat_message' vs 'announcement'), not recipient_type —
-- a player's public post and an organiser's announcement can both target
-- "everyone," but only one of them is official.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

DROP POLICY IF EXISTS "Event messages: participant chat to own group" ON public.event_messages;
CREATE POLICY "Event messages: participant chat" ON public.event_messages FOR INSERT
  WITH CHECK (
    sender_user_id = auth.uid()
    AND message_type = 'chat_message'
    AND recipient_user_id IS NULL
    AND (
      (recipient_type = 'group' AND EXISTS (
        SELECT 1 FROM public.trip_members
        WHERE trip_id = event_messages.trip_id
          AND profile_id = auth.uid()
          AND group_id = event_messages.recipient_group_id
      ))
      OR (recipient_type IN ('all', 'event') AND public.is_trip_member(trip_id))
    )
  );

NOTIFY pgrst, 'reload schema';
