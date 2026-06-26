-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION 006: Photos, Memory Pack & Leaderboard View
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── trip_photos ──────────────────────────────────────────────────────────────
CREATE TABLE public.trip_photos (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      UUID        NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  uploaded_by  UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  storage_path TEXT        NOT NULL,  -- path within Supabase Storage bucket
  caption      TEXT,
  taken_at     TIMESTAMPTZ,
  is_selected  BOOLEAN     NOT NULL DEFAULT false,  -- organiser selects for Memory Pack
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX trip_photos_trip_id_idx ON public.trip_photos(trip_id);

ALTER TABLE public.trip_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view trip photos"
  ON public.trip_photos FOR SELECT
  USING (public.is_trip_member(trip_id));
CREATE POLICY "Members can upload photos"
  ON public.trip_photos FOR INSERT
  WITH CHECK (
    uploaded_by = auth.uid()
    AND public.is_trip_member(trip_id)
  );
CREATE POLICY "Uploaders can delete own photos"
  ON public.trip_photos FOR DELETE
  USING (uploaded_by = auth.uid());
CREATE POLICY "Organisers can manage all photos"
  ON public.trip_photos FOR ALL
  USING (public.is_trip_organiser(trip_id));

-- ─── memory_packs ─────────────────────────────────────────────────────────────
CREATE TABLE public.memory_packs (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id            UUID        UNIQUE NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  winner_id          UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  winner_graphic_url TEXT,
  collage_url        TEXT,
  summary_url        TEXT,
  share_card_url     TEXT,
  generated_at       TIMESTAMPTZ,
  generated_by       UUID        REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.memory_packs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view memory pack"
  ON public.memory_packs FOR SELECT
  USING (public.is_trip_member(trip_id));
CREATE POLICY "Organisers can manage memory pack"
  ON public.memory_packs FOR ALL
  USING (public.is_trip_organiser(trip_id))
  WITH CHECK (public.is_trip_organiser(trip_id));

-- ─── Supabase Storage buckets ─────────────────────────────────────────────────
-- Run these separately in the Supabase dashboard Storage section,
-- or via the Supabase CLI:
--
-- supabase storage create trip-assets --public
-- supabase storage create trip-photos --public
--
-- Bucket: trip-assets  (logos, cover images) — public read
-- Bucket: trip-photos  (player photos, memory pack outputs) — public read
--
-- Storage RLS is managed via Supabase dashboard policies.
-- Recommended policies:
--   trip-assets: anyone can read; only authenticated users can upload
--   trip-photos: anyone can read; only trip members can upload

-- ─── LEADERBOARD VIEW ─────────────────────────────────────────────────────────
-- Computed in the database for consistency across all clients.
-- React Query subscribes to Realtime on score_entries;
-- when a change fires, the leaderboard query is invalidated and this view
-- is re-queried — giving live leaderboard with no polling.

CREATE OR REPLACE VIEW public.leaderboard_view AS
SELECT
  r.id                                          AS round_id,
  r.trip_id,
  sc.player_id,
  p.full_name,
  sc.playing_handicap,
  COALESCE(SUM(se.stableford_pts), 0)::INTEGER  AS total_stableford_pts,
  COUNT(se.id)::INTEGER                         AS holes_played,
  -- Rank: higher Stableford total = better rank
  RANK() OVER (
    PARTITION BY r.id
    ORDER BY COALESCE(SUM(se.stableford_pts), 0) DESC
  )::INTEGER                                    AS rank
FROM public.rounds r
JOIN public.scorecards sc ON sc.round_id = r.id
JOIN public.profiles p    ON p.id = sc.player_id
LEFT JOIN public.score_entries se ON se.scorecard_id = sc.id
WHERE sc.status != 'withdrawn'
GROUP BY r.id, r.trip_id, sc.player_id, p.full_name, sc.playing_handicap;

-- Note: Views in Supabase inherit table RLS. Since this view joins trips
-- and scorecards, the underlying RLS ensures users only see data from
-- trips they belong to when queried via the authenticated client.
