-- =============================================================================
-- profile_photos_deploy.sql
-- =============================================================================
-- Complete, standalone, idempotent deployment script for the profile-photo
-- storage bucket. Run this ONE file in the Supabase SQL Editor for the
-- project the production Vercel app is actually connected to.
--
-- Renamed from 'avatars' to 'profile-photos' per explicit preference.
-- "Bucket not found" matches the exact recurring "migration never applied
-- to production" pattern already seen multiple times in this project
-- (round-scoring migrations, event_messages) — this is very likely the
-- same class of issue, not a new bug. Includes the storage-object
-- equivalent of the schema-cache reload used for the event_messages fix.
--
-- Path convention: profile-photos/{user_id}/avatar.{ext} — a user can only
-- read/write inside their own folder (except public read, which is
-- intentional — avatars are shown to other trip members).
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('profile-photos', 'profile-photos', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 5242880, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "Profile photos: public read" ON storage.objects;
CREATE POLICY "Profile photos: public read" ON storage.objects FOR SELECT
  USING (bucket_id = 'profile-photos');

DROP POLICY IF EXISTS "Profile photos: owner upload" ON storage.objects;
CREATE POLICY "Profile photos: owner upload" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Profile photos: owner update" ON storage.objects;
CREATE POLICY "Profile photos: owner update" ON storage.objects FOR UPDATE
  USING (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Profile photos: owner delete" ON storage.objects;
CREATE POLICY "Profile photos: owner delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Old bucket/policies cleanup — harmless to leave, but tidy to remove if
-- 'avatars' was ever actually created. Commented out deliberately: only
-- run this if you've confirmed no existing avatar_url values still point
-- at the old bucket's URLs.
-- DROP POLICY IF EXISTS "Avatars: public read" ON storage.objects;
-- DROP POLICY IF EXISTS "Avatars: owner upload" ON storage.objects;
-- DROP POLICY IF EXISTS "Avatars: owner update" ON storage.objects;
-- DROP POLICY IF EXISTS "Avatars: owner delete" ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'avatars';

NOTIFY pgrst, 'reload schema';

-- ── Verification ─────────────────────────────────────────────────────────
select id, name, public, file_size_limit from storage.buckets where id = 'profile-photos';
select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'Profile photos%';
