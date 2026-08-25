-- =============================================================================
-- 065_moments_proxy_capture_rls.sql
-- =============================================================================
-- Field-Test Fix Package, item 4 — Moments INSERT RLS still assumed
-- player_id = auth.uid() (migration 028's "Moments: member create own"
-- policy). That assumption predates Side Games proxy entry and proxy
-- photo capture (migration 063 added moments.captured_by specifically
-- to represent this split) — it was never updated to match, which is
-- the actual, confirmed root cause of the 42501 error: Alex
-- (auth.uid()) capturing a photo FOR Marnie (player_id) is a
-- completely legitimate, already-designed-for case that this policy
-- simply never learned about.
--
-- The storage upload itself was NOT the problem — MomentCapture builds
-- its storage path from the uploader's own auth id (not player_id), so
-- "Moments storage: member upload own folder" already succeeds
-- regardless of proxy mode. Only the moments TABLE policy needed this
-- fix, confirmed by the exact error message (42501 on table
-- "moments", not on storage.objects).
--
-- Narrowest correct fix, not a global relaxation: a row is allowed
-- when EITHER the classic case still holds (player_id = auth.uid(),
-- completely unchanged, zero behaviour change for every normal
-- self-captured Moment) OR the row is a genuine proxy capture —
-- captured_by = auth.uid() (the real uploader) AND player_id/auth.uid()
-- are both trip_members of the same trip with the same, non-null
-- group_id (the same "same playing group" eligibility check already
-- used server-side for Side Games proxy entry and the moments API
-- route itself — not a new or looser standard, the same one).
--
-- Idempotent: safe to run more than once.
-- =============================================================================

DROP POLICY IF EXISTS "Moments: member create own" ON public.moments;

CREATE POLICY "Moments: member create own or proxy capture" ON public.moments FOR INSERT
  WITH CHECK (
    (
      player_id = auth.uid()
      OR (
        captured_by = auth.uid()
        AND EXISTS (
          SELECT 1
          FROM public.trip_members tm_subject
          JOIN public.trip_members tm_capturer
            ON tm_capturer.trip_id = tm_subject.trip_id
            AND tm_capturer.group_id = tm_subject.group_id
          WHERE tm_subject.trip_id = moments.trip_id
            AND tm_subject.profile_id = moments.player_id
            AND tm_capturer.profile_id = auth.uid()
            AND tm_subject.group_id IS NOT NULL
        )
      )
    )
    AND public.is_trip_member(trip_id)
    AND (
      group_id IS NULL
      OR EXISTS (SELECT 1 FROM public.trip_members WHERE trip_id = moments.trip_id AND profile_id = auth.uid() AND group_id = moments.group_id)
    )
  );

NOTIFY pgrst, 'reload schema';
