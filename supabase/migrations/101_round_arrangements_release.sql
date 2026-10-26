-- =============================================================================
-- 101_round_arrangements_release.sql
-- =============================================================================
-- Package 2 -- Between-Round Management, Handicap Release & Player Notifications.
--
-- WHY (root cause of the Lappen Invitational report):
--   * "Confirm & Release" (migration 062) only flipped rounds.setup_released. The
--     organiser's per-round handicap adjustments lived ONLY in the Begin Round
--     window's browser state until Start Round, so a fresh window the next day
--     silently recomputed every handicap from the profile.
--   * The player Starting Grid read live tables and showed each player's PROFILE
--     handicap, never the round handicap the organiser allocated.
--   * Nothing recorded what was released, so later edits changed what players saw
--     without any notice, and nobody was told anything.
--
-- WHAT THIS ADDS (additive only; no existing column, table, policy or row changes):
--   1. rounds.release_revision / rounds.released_at.
--   2. round_arrangements -- ONE authoritative, per-round, per-player snapshot taken
--      at release: group, tee time, starting hole, playing handicap. Players read it;
--      Start Round uses it. Completed rounds and profiles are never touched by it.
--   3. round_release_log -- append-only audit trail of every release / re-release.
--   4. release_round_arrangements() -- one transaction that locks the round, checks
--      the revision (so a duplicate or racing request can never release twice),
--      writes the snapshot, bumps the revision, logs it and records the in-app
--      announcement(s) in event_messages. Either all of it happens or none of it.
--
-- PREREQUISITES: 062 (rounds.setup_released), 025 (event_messages), 097 (cancelled
-- status). INDEPENDENT of migration 100 (Finish Round Early) -- apply in either order.
-- Safe to run more than once.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.release_round_arrangements(UUID, UUID, INTEGER, JSONB, JSONB, JSONB);
--   DROP TABLE IF EXISTS public.round_release_log;
--   DROP TABLE IF EXISTS public.round_arrangements;
--   ALTER TABLE public.rounds DROP COLUMN IF EXISTS release_revision, DROP COLUMN IF EXISTS released_at;
-- =============================================================================

ALTER TABLE public.rounds
  ADD COLUMN IF NOT EXISTS release_revision INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS released_at      TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS public.round_arrangements (
  round_id         UUID        NOT NULL REFERENCES public.rounds(id)       ON DELETE CASCADE,
  player_id        UUID        NOT NULL REFERENCES public.profiles(id)     ON DELETE CASCADE,
  group_id         UUID        NOT NULL REFERENCES public.trip_groups(id)  ON DELETE CASCADE,
  group_name       TEXT        NULL,
  tee_time         TEXT        NULL,
  starting_hole    INTEGER     NULL CHECK (starting_hole IS NULL OR starting_hole BETWEEN 1 AND 18),
  -- Whole number, signed: plus handicaps are negative (+2 is stored as -2). Deliberately NO golf-range CHECK:
  -- this must hold exactly what Start Round will write to scorecards.playing_handicap (INTEGER, unconstrained),
  -- including Course/Daily Handicaps above 54 or plus handicaps below -10 once slope is applied.
  playing_handicap INTEGER     NOT NULL,
  revision         INTEGER     NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, player_id)
);
CREATE INDEX IF NOT EXISTS round_arrangements_round_group_idx ON public.round_arrangements(round_id, group_id);

ALTER TABLE public.round_arrangements ENABLE ROW LEVEL SECURITY;
-- Members of the round's own event can read it. Nobody can write through the API
-- (no INSERT/UPDATE/DELETE policy): only release_round_arrangements() below does.
DROP POLICY IF EXISTS "Round arrangements: trip members read" ON public.round_arrangements;
CREATE POLICY "Round arrangements: trip members read" ON public.round_arrangements FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.rounds r WHERE r.id = round_arrangements.round_id AND public.is_trip_member(r.trip_id)));

CREATE TABLE IF NOT EXISTS public.round_release_log (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id            UUID        NOT NULL REFERENCES public.rounds(id)    ON DELETE CASCADE,
  revision            INTEGER     NOT NULL,
  kind                TEXT        NOT NULL CHECK (kind IN ('initial','revision')),
  released_by         UUID        NULL REFERENCES public.profiles(id)      ON DELETE SET NULL,
  released_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  changes             JSONB       NOT NULL DEFAULT '[]'::jsonb,
  affected_player_ids UUID[]      NOT NULL DEFAULT '{}',
  UNIQUE (round_id, revision)
);
ALTER TABLE public.round_release_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Round release log: organisers read" ON public.round_release_log;
CREATE POLICY "Round release log: organisers read" ON public.round_release_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.rounds r WHERE r.id = round_release_log.round_id AND public.is_trip_organiser(r.trip_id)));

-- p_rows:     [{player_id, group_id, group_name, tee_time, starting_hole, playing_handicap}]
-- p_changes:  per-player change list for the audit log (computed by the app from the previous snapshot)
-- p_messages: [{recipient_type:'all'|'player', recipient_user_id, message_type, message}]
-- Returns {ok:true, revision} | {ok:false, error:'not_found'|'not_upcoming'|'revision_conflict', revision}
CREATE OR REPLACE FUNCTION public.release_round_arrangements(
  p_round_id          UUID,
  p_actor             UUID,
  p_expected_revision INTEGER,
  p_rows              JSONB,
  p_changes           JSONB,
  p_messages          JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip_id  UUID;
  v_status   TEXT;
  v_revision INTEGER;
  v_new      INTEGER;
  v_affected UUID[];
BEGIN
  SELECT trip_id, status, release_revision INTO v_trip_id, v_status, v_revision
  FROM public.rounds WHERE id = p_round_id FOR UPDATE;

  IF v_trip_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF v_status <> 'upcoming' THEN RETURN jsonb_build_object('ok', false, 'error', 'not_upcoming', 'status', v_status); END IF;
  IF v_revision <> p_expected_revision THEN
    RETURN jsonb_build_object('ok', false, 'error', 'revision_conflict', 'revision', v_revision);
  END IF;

  -- The actor must be an organiser of THIS round's event (the API checks too; this is the backstop).
  IF NOT EXISTS (SELECT 1 FROM public.trip_members WHERE trip_id = v_trip_id AND profile_id = p_actor AND role = 'organiser') THEN
    RAISE EXCEPTION 'NOT_ORGANISER';
  END IF;

  v_new := v_revision + 1;

  -- Every row must belong to this event: a player of this trip, in a group of this trip.
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_rows) AS x(player_id UUID, group_id UUID)
    WHERE NOT EXISTS (SELECT 1 FROM public.trip_members m WHERE m.trip_id = v_trip_id AND m.profile_id = x.player_id)
       OR NOT EXISTS (SELECT 1 FROM public.trip_groups  g WHERE g.trip_id = v_trip_id AND g.id = x.group_id)
  ) THEN RAISE EXCEPTION 'ROW_NOT_IN_EVENT'; END IF;

  DELETE FROM public.round_arrangements
   WHERE round_id = p_round_id
     AND player_id NOT IN (SELECT player_id FROM jsonb_to_recordset(p_rows) AS x(player_id UUID));

  INSERT INTO public.round_arrangements (round_id, player_id, group_id, group_name, tee_time, starting_hole, playing_handicap, revision, updated_at)
  SELECT p_round_id, x.player_id, x.group_id, x.group_name, x.tee_time, x.starting_hole, x.playing_handicap, v_new, now()
  FROM jsonb_to_recordset(p_rows) AS x(player_id UUID, group_id UUID, group_name TEXT, tee_time TEXT, starting_hole INTEGER, playing_handicap INTEGER)
  ON CONFLICT (round_id, player_id) DO UPDATE SET
    group_id = EXCLUDED.group_id, group_name = EXCLUDED.group_name, tee_time = EXCLUDED.tee_time,
    starting_hole = EXCLUDED.starting_hole, playing_handicap = EXCLUDED.playing_handicap,
    revision = EXCLUDED.revision, updated_at = now();

  UPDATE public.rounds SET setup_released = true, release_revision = v_new, released_at = now() WHERE id = p_round_id;

  SELECT COALESCE(array_agg(DISTINCT (c->>'player_id')::UUID), '{}') INTO v_affected FROM jsonb_array_elements(p_changes) c;

  INSERT INTO public.round_release_log (round_id, revision, kind, released_by, changes, affected_player_ids)
  VALUES (p_round_id, v_new, CASE WHEN v_revision = 0 THEN 'initial' ELSE 'revision' END, p_actor, p_changes, v_affected);

  INSERT INTO public.event_messages (trip_id, sender_user_id, message_type, recipient_type, recipient_user_id, message)
  SELECT v_trip_id, p_actor, m.message_type, m.recipient_type,
         CASE WHEN m.recipient_type = 'player' THEN m.recipient_user_id END, m.message
  FROM jsonb_to_recordset(p_messages) AS m(message_type TEXT, recipient_type TEXT, recipient_user_id UUID, message TEXT);

  RETURN jsonb_build_object('ok', true, 'revision', v_new);
END;
$$;

REVOKE ALL ON FUNCTION public.release_round_arrangements(UUID, UUID, INTEGER, JSONB, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_round_arrangements(UUID, UUID, INTEGER, JSONB, JSONB, JSONB) TO service_role;
