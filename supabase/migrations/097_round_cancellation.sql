-- =============================================================================
-- 097_round_cancellation.sql
-- =============================================================================
-- Post-Lappen priority release, Package 2 -- cancel an UNPLAYED round.
--
-- Additive only:
--   1. rounds.status gains a fourth value, 'cancelled'. The existing status
--      CHECK is located by scanning pg_constraint (its auto-generated name is
--      not relied on, the same defensive pattern as migration 012) and
--      recreated with all four values. No existing row is touched.
--   2. Three nullable columns record who/when/why on the round itself.
--   3. round_status_events is an append-only audit trail of every cancel and
--      reinstate. RLS is enabled with NO policies: only the service-role API
--      routes read or write it.
--
-- Nothing here changes scoring, scorecards, side games or any existing data.
--
-- ROLLBACK (only valid while NO round has status 'cancelled'; reinstate any
-- cancelled round in the app first, or the CHECK below will fail to re-add):
--   DROP TABLE IF EXISTS public.round_status_events;
--   ALTER TABLE public.rounds DROP COLUMN IF EXISTS cancelled_at,
--                             DROP COLUMN IF EXISTS cancelled_by,
--                             DROP COLUMN IF EXISTS cancel_reason;
--   ALTER TABLE public.rounds DROP CONSTRAINT IF EXISTS rounds_status_check;
--   ALTER TABLE public.rounds ADD CONSTRAINT rounds_status_check
--     CHECK (status IN ('upcoming','active','completed'));
-- =============================================================================

DO $$
DECLARE
  v_conname TEXT;
BEGIN
  FOR v_conname IN
    SELECT c.conname
    FROM   pg_constraint c
    JOIN   pg_class      r ON r.oid = c.conrelid
    JOIN   pg_namespace  n ON n.oid = r.relnamespace
    WHERE  n.nspname = 'public'
      AND  r.relname = 'rounds'
      AND  c.contype = 'c'
      AND  pg_get_constraintdef(c.oid) LIKE '%upcoming%'
      AND  pg_get_constraintdef(c.oid) LIKE '%completed%'
  LOOP
    EXECUTE format('ALTER TABLE public.rounds DROP CONSTRAINT %I', v_conname);
  END LOOP;

  ALTER TABLE public.rounds ADD CONSTRAINT rounds_status_check
    CHECK (status IN ('upcoming','active','completed','cancelled'));
END $$;

ALTER TABLE public.rounds
  ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS cancelled_by  UUID        NULL REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT        NULL;

CREATE TABLE IF NOT EXISTS public.round_status_events (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id     UUID        NOT NULL REFERENCES public.trips(id)  ON DELETE CASCADE,
  round_id    UUID        NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  action      TEXT        NOT NULL CHECK (action IN ('cancelled','reinstated')),
  from_status TEXT        NOT NULL,
  to_status   TEXT        NOT NULL,
  reason      TEXT        NULL,
  actor_id    UUID        NOT NULL REFERENCES public.profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS round_status_events_round_idx ON public.round_status_events (round_id, created_at);

ALTER TABLE public.round_status_events ENABLE ROW LEVEL SECURITY;
