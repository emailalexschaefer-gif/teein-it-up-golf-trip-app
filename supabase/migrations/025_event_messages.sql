-- =============================================================================
-- 025_event_messages.sql
-- =============================================================================
-- Organiser notification / announcement foundation (My HQ Alerts &
-- Notifications sprint). Explicitly NOT a full chat platform — one
-- channel per trip, organiser-initiated messages only in this pass.
--
-- message_type: 'announcement' | 'group_notification' | 'player_notification'
--   ('chat_message' is reserved for a future open-chat pass — not used yet)
-- recipient_type: 'all' | 'group' | 'player'
--
-- Idempotent: safe to run more than once.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.event_messages (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id          UUID        NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  sender_user_id   UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message_type     TEXT        NOT NULL CHECK (message_type IN ('announcement', 'group_notification', 'player_notification', 'chat_message')),
  recipient_type   TEXT        NOT NULL CHECK (recipient_type IN ('all', 'group', 'player')),
  recipient_group_id UUID      REFERENCES public.trip_groups(id) ON DELETE CASCADE,
  recipient_user_id  UUID      REFERENCES public.profiles(id) ON DELETE CASCADE,
  message          TEXT        NOT NULL,
  is_pinned        BOOLEAN     NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (recipient_type = 'all'    AND recipient_group_id IS NULL AND recipient_user_id IS NULL) OR
    (recipient_type = 'group'  AND recipient_group_id IS NOT NULL AND recipient_user_id IS NULL) OR
    (recipient_type = 'player' AND recipient_user_id IS NOT NULL AND recipient_group_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS event_messages_trip_id_idx ON public.event_messages(trip_id, created_at DESC);

ALTER TABLE public.event_messages ENABLE ROW LEVEL SECURITY;

-- Read: only confirmed trip members, and only messages actually addressed
-- to them — event-wide, their own group, or personally. A player cannot
-- see a message aimed at a different group, per the explicit requirement.
DROP POLICY IF EXISTS "Event messages: recipients read" ON public.event_messages;
CREATE POLICY "Event messages: recipients read" ON public.event_messages FOR SELECT
  USING (
    public.is_trip_member(trip_id)
    AND (
      recipient_type = 'all'
      OR (recipient_type = 'group' AND recipient_group_id IN (
        SELECT group_id FROM public.trip_members WHERE trip_id = event_messages.trip_id AND profile_id = auth.uid()
      ))
      OR (recipient_type = 'player' AND recipient_user_id = auth.uid())
      OR sender_user_id = auth.uid()
    )
  );

-- Write: only organisers may send announcements or targeted notifications
-- in this pass (player-to-player chat is explicitly out of scope).
DROP POLICY IF EXISTS "Event messages: organiser send" ON public.event_messages;
CREATE POLICY "Event messages: organiser send" ON public.event_messages FOR INSERT
  WITH CHECK (
    sender_user_id = auth.uid()
    AND message_type IN ('announcement', 'group_notification', 'player_notification')
    AND EXISTS (
      SELECT 1 FROM public.trip_members
      WHERE trip_id = event_messages.trip_id AND profile_id = auth.uid() AND role = 'organiser'
    )
  );

-- Organiser can pin/unpin their trip's own messages.
DROP POLICY IF EXISTS "Event messages: organiser update" ON public.event_messages;
CREATE POLICY "Event messages: organiser update" ON public.event_messages FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.trip_members
    WHERE trip_id = event_messages.trip_id AND profile_id = auth.uid() AND role = 'organiser'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.trip_members
    WHERE trip_id = event_messages.trip_id AND profile_id = auth.uid() AND role = 'organiser'
  ));
