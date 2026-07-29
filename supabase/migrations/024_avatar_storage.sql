-- =============================================================================
-- 024_avatar_storage.sql
-- =============================================================================
-- Profile-avatar upload support (Sprint 5C polish — Stage 2 of the
-- Moments/My HQ product architecture update).
--
-- Creates a public 'avatars' storage bucket and RLS policies on
-- storage.objects. Does NOT touch any existing table, column, or
-- permission — purely new, isolated infrastructure. profiles.avatar_url
-- already exists (migration 001) and already displays correctly with an
-- initials fallback; this migration only adds the ability to actually
-- upload a file there.
--
-- Path convention: avatars/{user_id}/{filename} — RLS policies below key
-- off the first path segment matching auth.uid(), so a user can only
-- write inside their own folder.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Public read — avatars are displayed to other trip members (leaderboard,
-- scorecards, group cards, chat, etc.), so they need to be publicly
-- readable via their URL, same as any typical avatar-hosting setup.
DROP POLICY IF EXISTS "Avatars: public read" ON storage.objects;
CREATE POLICY "Avatars: public read" ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

-- A user may only upload into their own folder (avatars/{their_user_id}/...).
DROP POLICY IF EXISTS "Avatars: owner upload" ON storage.objects;
CREATE POLICY "Avatars: owner upload" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Avatars: owner update" ON storage.objects;
CREATE POLICY "Avatars: owner update" ON storage.objects FOR UPDATE
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Avatars: owner delete" ON storage.objects;
CREATE POLICY "Avatars: owner delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
