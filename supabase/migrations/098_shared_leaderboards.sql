-- =============================================================================
-- 098_shared_leaderboards.sql
-- =============================================================================
-- Package 1 (post-Lappen) -- organiser-controlled PUBLIC live leaderboard link.
--
-- One row = one shareable link for one event. The row stores NO scores: the
-- public page computes the standings live from the same canonical leaderboard
-- code the app uses. A token is an unguessable 256-bit value (43 base64url
-- characters). Revoking a link marks the row 'revoked'; turning sharing on
-- again creates a NEW row with a NEW token, so an old link can never come
-- back to life.
--
-- No event is public unless an organiser explicitly enables sharing: this
-- migration creates an empty table and changes nothing else.
--
-- RLS is enabled with NO policies: the table is read and written only by
-- server routes using the service role (the same model as shared_presentations).
--
-- Run AFTER 097_round_cancellation.sql.
--
-- ROLLBACK (removes every public leaderboard link; nothing else depends on it):
--   DROP TABLE IF EXISTS public.shared_leaderboards;
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.shared_leaderboards (
  id         UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id    UUID        NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  token      TEXT        NOT NULL UNIQUE CHECK (char_length(token) >= 32),
  status     TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_by UUID        NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ NULL,
  revoked_by UUID        NULL REFERENCES public.profiles(id)
);

-- At most one ACTIVE link per event (race-safe enable); revoked history is kept.
CREATE UNIQUE INDEX IF NOT EXISTS shared_leaderboards_one_active_per_trip
  ON public.shared_leaderboards (trip_id) WHERE status = 'active';

ALTER TABLE public.shared_leaderboards ENABLE ROW LEVEL SECURITY;
