-- =============================================================================
-- event_messages_deploy.sql
-- =============================================================================
-- ⚠️ IMPORTANT — re-run this even if event_messages already exists and
-- group chat is already working. An earlier draft of guidance for this
-- table used 'event' as a recipient_type CHECK value instead of 'all'.
-- If that earlier version was ever run against this database, the live
-- constraint may still say CHECK (recipient_type IN ('event','group',
-- 'player')) — which rejects 'all' (organiser event-wide announcements)
-- while still accepting 'group' (ordinary group chat), producing exactly
-- this symptom: group chat works, event-wide announcements fail with a
-- generic error. This script DROPs and re-ADDs the constraint with the
-- correct 'all' value, which fixes that mismatch if it's the cause.
--
-- Complete, standalone, idempotent deployment script for the event_messages
-- table. Run this ONE file in the Supabase SQL Editor for whichever project
-- the production Vercel app is actually connected to (see the note at the
-- very bottom about verifying that first — I cannot check Vercel's
-- environment variables or which Supabase project is live from here).
--
-- This does NOT redesign the messaging feature. The table structure and
-- RLS logic below are unchanged from migration 025 — verified against the
-- REAL schema of this project before writing anything: trip_members uses
-- profile_id (not user_id), has no status column, and there is no separate
-- group_members table (group membership is trip_members.group_id). The
-- brief's example policies used placeholder names that don't match this
-- project's actual schema — copying them verbatim would have failed. What's
-- added here vs. the original 025: explicit named constraints (was inline/
-- anonymous, harder to safely re-target with DROP CONSTRAINT), two more
-- indexes, and the PostgREST schema-cache reload, which is very likely the
-- actual fix for "Could not find the table... in the schema cache" if the
-- table already exists but PostgREST hasn't picked it up yet.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.event_messages (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id            UUID        NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  sender_user_id     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message_type       TEXT        NOT NULL,
  recipient_type     TEXT        NOT NULL,
  recipient_group_id UUID        REFERENCES public.trip_groups(id) ON DELETE CASCADE,
  recipient_user_id  UUID        REFERENCES public.profiles(id) ON DELETE CASCADE,
  message            TEXT        NOT NULL,
  is_pinned          BOOLEAN     NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Named constraints (explicit, so they can be safely dropped/recreated
-- later — the original inline CHECKs worked but had Postgres-generated
-- names, which is why this pass switches to named ones). ───────────────────
ALTER TABLE public.event_messages DROP CONSTRAINT IF EXISTS event_messages_message_type_check;
ALTER TABLE public.event_messages ADD CONSTRAINT event_messages_message_type_check
  CHECK (message_type IN ('announcement', 'group_notification', 'player_notification', 'chat_message'));

ALTER TABLE public.event_messages DROP CONSTRAINT IF EXISTS event_messages_recipient_type_check;
ALTER TABLE public.event_messages ADD CONSTRAINT event_messages_recipient_type_check
  CHECK (recipient_type IN ('all', 'group', 'player'));

ALTER TABLE public.event_messages DROP CONSTRAINT IF EXISTS event_messages_recipient_consistency_check;
ALTER TABLE public.event_messages ADD CONSTRAINT event_messages_recipient_consistency_check
  CHECK (
    (recipient_type = 'all'    AND recipient_group_id IS NULL AND recipient_user_id IS NULL) OR
    (recipient_type = 'group'  AND recipient_group_id IS NOT NULL AND recipient_user_id IS NULL) OR
    (recipient_type = 'player' AND recipient_user_id IS NOT NULL AND recipient_group_id IS NULL)
  );

-- ── Indexes for the actual read patterns ────────────────────────────────────
CREATE INDEX IF NOT EXISTS event_messages_trip_created_idx ON public.event_messages (trip_id, created_at DESC);
CREATE INDEX IF NOT EXISTS event_messages_group_idx ON public.event_messages (recipient_group_id) WHERE recipient_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_messages_user_idx ON public.event_messages (recipient_user_id) WHERE recipient_user_id IS NOT NULL;

ALTER TABLE public.event_messages ENABLE ROW LEVEL SECURITY;

-- ── Read policy — real schema: trip_members.profile_id, trip_members.
-- group_id for group membership, is_trip_member() helper already used
-- throughout this project's other RLS policies (not invented for this). ────
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

-- ── Insert policy — organiser only ──────────────────────────────────────────
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

-- ── Update policy — organiser only (e.g. pin/unpin) ─────────────────────────
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

-- ── Force PostgREST to pick up the table immediately, rather than waiting
-- for its own cache refresh cycle. This is very likely the actual fix if
-- the table exists but the error persists. ─────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- VERIFICATION — run these after the script above completes.
-- =============================================================================

-- Should return: public.event_messages
select to_regclass('public.event_messages');

-- Should list all 9 columns with correct types/nullability
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'event_messages'
order by ordinal_position;

-- Should list 3 policies: recipients read (SELECT), organiser send
-- (INSERT), organiser update (UPDATE)
select policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'event_messages';
