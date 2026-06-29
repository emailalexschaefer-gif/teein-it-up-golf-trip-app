-- ─────────────────────────────────────────────────────────────────────────────
-- 006: Photos, Memory Pack & Leaderboard View
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.trip_photos (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      UUID        NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  uploaded_by  UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  storage_path TEXT        NOT NULL,
  caption      TEXT,
  taken_at     TIMESTAMPTZ,
  is_selected  BOOLEAN     NOT NULL DEFAULT false,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

ALTER TABLE public.trip_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members: view" ON public.trip_photos FOR SELECT USING (public.is_trip_member(trip_id));
CREATE POLICY "Members: upload" ON public.trip_photos FOR INSERT WITH CHECK (uploaded_by = auth.uid() AND public.is_trip_member(trip_id));
CREATE POLICY "Own: delete" ON public.trip_photos FOR DELETE USING (uploaded_by = auth.uid());
CREATE POLICY "Organisers: manage all" ON public.trip_photos FOR ALL USING (public.is_trip_organiser(trip_id));

ALTER TABLE public.memory_packs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members: view" ON public.memory_packs FOR SELECT USING (public.is_trip_member(trip_id));
CREATE POLICY "Organisers: manage" ON public.memory_packs FOR ALL
  USING (public.is_trip_organiser(trip_id)) WITH CHECK (public.is_trip_organiser(trip_id));

-- ─── Leaderboard view ─────────────────────────────────────────────────────────
-- Computed in Postgres — consistent across all clients.
-- React Query subscribes to Realtime on score_entries then re-queries this view.

CREATE OR REPLACE VIEW public.leaderboard_view AS
SELECT
  r.id                                             AS round_id,
  r.trip_id,
  sc.player_id,
  p.full_name,
  sc.playing_handicap,
  COALESCE(SUM(se.stableford_pts), 0)::INTEGER     AS total_stableford_pts,
  COUNT(se.id)::INTEGER                            AS holes_played,
  RANK() OVER (
    PARTITION BY r.id
    ORDER BY COALESCE(SUM(se.stableford_pts), 0) DESC
  )::INTEGER                                       AS rank
FROM public.rounds r
JOIN public.scorecards sc ON sc.round_id = r.id
JOIN public.profiles p    ON p.id = sc.player_id
LEFT JOIN public.score_entries se ON se.scorecard_id = sc.id
WHERE sc.status != 'withdrawn'
GROUP BY r.id, r.trip_id, sc.player_id, p.full_name, sc.playing_handicap;

-- Storage buckets — create these in the Supabase dashboard or via CLI:
--   supabase storage create trip-assets --public
--   supabase storage create trip-photos --public
