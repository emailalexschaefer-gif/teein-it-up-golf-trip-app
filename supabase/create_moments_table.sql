-- =============================================================================
-- create_moments_table.sql
-- =============================================================================
-- Confirmed root cause: PGRST205 "Could not find the table 'public.moments'
-- in the schema cache" — the moments table itself was never created in
-- production. The storage bucket (fixed separately, already confirmed
-- working) is a different piece entirely; this is the actual data table
-- the app writes each Moment's record into.
--
-- This is everything from migration 028_moments.sql EXCEPT the storage
-- bucket section (already applied and confirmed working — re-running it
-- is harmless either way since it's idempotent, but it's left out here
-- to keep this script focused on what's actually still missing).
--
-- One deliberate correction from the original migration: image_path is
-- NOT NULL below is changed to nullable. The application's own POST
-- route already validates "a photo OR a caption" (caption-only Moments
-- are explicitly allowed), so a NOT NULL constraint here would break
-- that already-intended path the first time someone tries it — this
-- table has never existed in production, so this is the one point where
-- fixing that costs nothing (no existing data to reconcile).
--
-- Idempotent: safe to run more than once.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.moments (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id        UUID        NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  round_id       UUID        REFERENCES public.rounds(id) ON DELETE SET NULL,
  hole_number    INTEGER,
  player_id      UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  group_id       UUID        REFERENCES public.trip_groups(id) ON DELETE SET NULL,
  caption        TEXT,
  image_path     TEXT,  -- nullable: see note above (caption-only Moments)
  audience       TEXT        NOT NULL DEFAULT 'everyone' CHECK (audience IN ('everyone', 'group')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (audience = 'everyone' OR (audience = 'group' AND group_id IS NOT NULL)),
  CHECK (image_path IS NOT NULL OR caption IS NOT NULL)  -- must have at least one
);

CREATE INDEX IF NOT EXISTS moments_trip_created_idx ON public.moments(trip_id, created_at DESC);
CREATE INDEX IF NOT EXISTS moments_player_idx ON public.moments(player_id);
CREATE INDEX IF NOT EXISTS moments_round_idx ON public.moments(round_id) WHERE round_id IS NOT NULL;

ALTER TABLE public.moments ENABLE ROW LEVEL SECURITY;

-- Read: trip members only, and only moments actually addressed to them —
-- 'everyone' moments, or 'group' moments where the viewer shares that
-- group, or their own moments regardless of audience.
DROP POLICY IF EXISTS "Moments: recipients read" ON public.moments;
CREATE POLICY "Moments: recipients read" ON public.moments FOR SELECT
  USING (
    public.is_trip_member(trip_id)
    AND (
      audience = 'everyone'
      OR (audience = 'group' AND group_id IN (
        SELECT group_id FROM public.trip_members WHERE trip_id = moments.trip_id AND profile_id = auth.uid()
      ))
      OR player_id = auth.uid()
    )
  );

-- Write: any confirmed trip member may create a Moment for themselves,
-- scoped to their own player_id and their own actual group.
DROP POLICY IF EXISTS "Moments: member create own" ON public.moments;
CREATE POLICY "Moments: member create own" ON public.moments FOR INSERT
  WITH CHECK (
    player_id = auth.uid()
    AND public.is_trip_member(trip_id)
    AND (
      group_id IS NULL
      OR EXISTS (SELECT 1 FROM public.trip_members WHERE trip_id = moments.trip_id AND profile_id = auth.uid() AND group_id = moments.group_id)
    )
  );

-- Delete: uploader or organiser only.
DROP POLICY IF EXISTS "Moments: owner or organiser delete" ON public.moments;
CREATE POLICY "Moments: owner or organiser delete" ON public.moments FOR DELETE
  USING (
    player_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.trip_members WHERE trip_id = moments.trip_id AND profile_id = auth.uid() AND role = 'organiser')
  );

-- ── Link Moments into the existing Chat feed ────────────────────────────────
ALTER TABLE public.event_messages DROP CONSTRAINT IF EXISTS event_messages_message_type_check;
ALTER TABLE public.event_messages ADD CONSTRAINT event_messages_message_type_check
  CHECK (message_type IN ('announcement', 'group_notification', 'player_notification', 'chat_message', 'moment'));

ALTER TABLE public.event_messages ADD COLUMN IF NOT EXISTS moment_id UUID REFERENCES public.moments(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS event_messages_moment_idx ON public.event_messages(moment_id) WHERE moment_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
