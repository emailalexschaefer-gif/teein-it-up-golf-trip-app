-- Standalone deploy copy of migration 028, matching the established pattern for this project's deployment gaps.

-- =============================================================================
-- 028_moments.sql
-- =============================================================================
-- Sprint 6 — Event Story & Moments.
--
-- Design decisions, made after re-reading docs/MOMENTS_SPRINT6_VISION.md
-- and docs/MY_GOLF_ARCHITECTURE.md (both written before this sprint
-- started, capturing the intended shape) rather than designing from
-- scratch:
--
-- 1. Moments get their OWN table (not just an event_messages row) because
--    they carry structured fields (hole_number, audience, image_path)
--    that Event Story and My Moments need to query directly — cramming
--    that into event_messages.message would mean parsing free text.
-- 2. Moments ALSO get a corresponding event_messages row (message_type =
--    'moment', linked via moment_id) so Chat's existing feed naturally
--    includes them without a second feed — directly satisfying "do not
--    create a second chat feed" from the brief. Chat's query already
--    returns message_type; the client just renders 'moment' rows
--    differently (image + caption) instead of adding a parallel fetch.
-- 3. Audience ('everyone' | 'group') mirrors event_messages' own
--    recipient_type model exactly, for the same reason: consistency, and
--    RLS that's easy to reason about because it's the same shape twice.
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
  image_path     TEXT        NOT NULL,
  audience       TEXT        NOT NULL DEFAULT 'everyone' CHECK (audience IN ('everyone', 'group')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (audience = 'everyone' OR (audience = 'group' AND group_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS moments_trip_created_idx ON public.moments(trip_id, created_at DESC);
CREATE INDEX IF NOT EXISTS moments_player_idx ON public.moments(player_id);
CREATE INDEX IF NOT EXISTS moments_round_idx ON public.moments(round_id) WHERE round_id IS NOT NULL;

ALTER TABLE public.moments ENABLE ROW LEVEL SECURITY;

-- Read: trip members only, and only moments actually addressed to them —
-- 'everyone' moments, or 'group' moments where the viewer shares that
-- group, or their own moments regardless of audience (an uploader should
-- always see their own Moment). Same shape as event_messages' read policy.
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

-- Write: any confirmed trip member may create a Moment for themselves —
-- unlike event_messages' organiser-gated announcement policy, this is
-- intentionally open to every participant (Part 7: "Players can capture
-- Moments"), scoped to their own player_id and their own actual group.
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

-- Delete: uploader or organiser only (matches the brief's implicit model
-- — no explicit delete requirement was stated, but leaving this
-- unrestricted would be an oversight, and this mirrors the
-- uploader-or-organiser pattern already used for avatars).
DROP POLICY IF EXISTS "Moments: owner or organiser delete" ON public.moments;
CREATE POLICY "Moments: owner or organiser delete" ON public.moments FOR DELETE
  USING (
    player_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.trip_members WHERE trip_id = moments.trip_id AND profile_id = auth.uid() AND role = 'organiser')
  );

-- ── Link Moments into the existing Chat feed ────────────────────────────────
-- Widen event_messages.message_type to include 'moment', and add a
-- moment_id reference so a moment-type message row can point at its full
-- Moment record. This is the mechanism that satisfies "do not create a
-- second chat feed" — Chat's existing query/RLS already work for this
-- new message_type without any additional policy needed, since
-- event_messages' own read policy doesn't care what message_type a row
-- has, only who it's addressed to.
ALTER TABLE public.event_messages DROP CONSTRAINT IF EXISTS event_messages_message_type_check;
ALTER TABLE public.event_messages ADD CONSTRAINT event_messages_message_type_check
  CHECK (message_type IN ('announcement', 'group_notification', 'player_notification', 'chat_message', 'moment'));

ALTER TABLE public.event_messages ADD COLUMN IF NOT EXISTS moment_id UUID REFERENCES public.moments(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS event_messages_moment_idx ON public.event_messages(moment_id) WHERE moment_id IS NOT NULL;

-- ── Storage bucket ───────────────────────────────────────────────────────────
-- Same RLS shape as the profile-photos bucket (owner-scoped folder,
-- established pattern), except read access is scoped to trip members
-- rather than fully public — Moments are event-private, not public
-- avatars. Folder structure: {trip_id}/{round_id-or-'general'}/{player_id}/
-- {filename}, matching Part 9's spec (trip-id/round-id/player-id/filename).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('event-moments', 'event-moments', false, 8388608, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Moments storage: trip members read" ON storage.objects;
CREATE POLICY "Moments storage: trip members read" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'event-moments'
    AND public.is_trip_member((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS "Moments storage: member upload own folder" ON storage.objects;
CREATE POLICY "Moments storage: member upload own folder" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'event-moments'
    AND public.is_trip_member((storage.foldername(name))[1]::uuid)
    AND (storage.foldername(name))[3] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Moments storage: owner delete" ON storage.objects;
CREATE POLICY "Moments storage: owner delete" ON storage.objects FOR DELETE
  USING (
    bucket_id = 'event-moments'
    AND (storage.foldername(name))[3] = auth.uid()::text
  );

NOTIFY pgrst, 'reload schema';
