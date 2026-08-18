-- =============================================================================
-- 059_event_logo_storage.sql
-- =============================================================================
-- Item A — event logo. No new column needed: trips.logo_url has existed
-- since the original schema (migration 002) and is already read and
-- displayed with a graceful initials fallback (TripCard.tsx) — the only
-- genuine gap was that nothing could ever write to it. This migration
-- is the write path.
--
-- Directly mirrors 024_avatar_storage.sql's proven pattern — public
-- bucket, path-prefix-scoped RLS — with one deliberate difference:
-- avatars scope by auth.uid() (a user owns their own folder); this
-- scopes by is_trip_organiser(trip_id) (the same SECURITY DEFINER
-- helper already used throughout this project's RLS, not a new
-- authorization concept), since a trip's logo belongs to whoever
-- organises that trip, not to a single user's own folder.
--
-- Path convention: event-logos/{trip_id}/{filename} — the first path
-- segment is the trip_id, checked against is_trip_organiser on every
-- write.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('event-logos', 'event-logos', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Public read — an event logo appears on the public invitation landing
-- page, before the viewer has authenticated at all, so it must be
-- readable without any session.
DROP POLICY IF EXISTS "Event logos: public read" ON storage.objects;
CREATE POLICY "Event logos: public read" ON storage.objects FOR SELECT
  USING (bucket_id = 'event-logos');

DROP POLICY IF EXISTS "Event logos: organiser upload" ON storage.objects;
CREATE POLICY "Event logos: organiser upload" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'event-logos'
    AND public.is_trip_organiser(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "Event logos: organiser update" ON storage.objects;
CREATE POLICY "Event logos: organiser update" ON storage.objects FOR UPDATE
  USING (bucket_id = 'event-logos' AND public.is_trip_organiser(((storage.foldername(name))[1])::uuid))
  WITH CHECK (bucket_id = 'event-logos' AND public.is_trip_organiser(((storage.foldername(name))[1])::uuid));

DROP POLICY IF EXISTS "Event logos: organiser delete" ON storage.objects;
CREATE POLICY "Event logos: organiser delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'event-logos' AND public.is_trip_organiser(((storage.foldername(name))[1])::uuid));
