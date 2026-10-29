-- =============================================================================
-- MIGRATION 104 (PENDING) -- Package 4 / Ambrose (gross): competition teams, round team entries, team scoring with revision-based conflict control.
-- STATUS: NOT APPLIED to any database (production or otherwise). Kept in supabase/pending-104/ -- NOT in supabase/migrations/ -- so no tool replays it by accident.
-- Apply to production ONLY on Alex's explicit approval, after the preflight, in the order given in PRODUCTION_TEST_RUNBOOK_V8.md.
-- Purely ADDITIVE: creates new objects only (8 tables, 16 functions, 1 trigger on a new table, indexes, RLS policies on the new tables, grants on the new objects).
-- Does not alter rounds, scorecards, score_entries, any existing trigger, function, policy or grant (proved by a before/after catalog comparison; see the report).
-- Atomic: the whole file runs in one transaction -- if anything fails, nothing is applied. Re-runnable (IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS).
-- Undo: supabase/pending-104/104_ROLLBACK.sql (removes only these objects; deletes Ambrose data; existing Stableford data is unaffected).
-- No data backfill. Round-number storage is deliberately NOT part of this file (kept separate).
-- Depends on existing: profiles, trips, trip_members, trip_groups, rounds (incl. setup_released), holes, is_trip_member(), is_trip_organiser().
-- =============================================================================
BEGIN;

-- 1. Event-level team identity (reusable across rounds; holds NO roster -- the roster truth is round_team_members).
CREATE TABLE IF NOT EXISTS public.competition_teams (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     UUID        NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  colour      TEXT        NULL,
  status      TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by  UUID        NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS competition_teams_trip_name_uq ON public.competition_teams (trip_id, lower(btrim(name))) WHERE status = 'active';

-- 2. Per-round competition settings (keeps rounds.scoring_format untouched; 'ambrose' is stored there as today).
CREATE TABLE IF NOT EXISTS public.round_competition_config (
  round_id               UUID        PRIMARY KEY REFERENCES public.rounds(id) ON DELETE CASCADE,
  format                 TEXT        NOT NULL CHECK (format IN ('ambrose_2','ambrose_4')),
  team_size              SMALLINT    NOT NULL CHECK (team_size IN (2,4)),
  handicap_method        TEXT        NOT NULL CHECK (handicap_method IN ('gross_only','club_divisor','weighted_scramble','organiser_entered')),  -- 'gross_only' = no allowance is applied or implied
  handicap_params        JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- snapshot of allowances used, so later code changes never alter a round
  min_drives_per_player  SMALLINT    NULL CHECK (min_drives_per_player IS NULL OR min_drives_per_player >= 0), -- NULL = not tracked
  setup_reopened_at      TIMESTAMPTZ NULL,                    -- set only by reopen_team_setup(): the organiser's audited reopening of a RELEASED round's team set-up (before any score exists)
  setup_reopened_by      UUID        NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by             UUID        NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT round_comp_format_size CHECK ((format = 'ambrose_2' AND team_size = 2) OR (format = 'ambrose_4' AND team_size = 4))
);

-- 3. A team's participation in one round = the roster snapshot + scorer + handicap snapshot for that round.
CREATE TABLE IF NOT EXISTS public.round_team_entries (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id              UUID        NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  team_id               UUID        NOT NULL REFERENCES public.competition_teams(id) ON DELETE RESTRICT,
  entry_name            TEXT        NOT NULL,                       -- name snapshot: renaming the team later never rewrites a played round
  group_id              UUID        NULL REFERENCES public.trip_groups(id) ON DELETE SET NULL,  -- physical playing group; NOT the team
  nominated_scorer_id   UUID        NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  status                TEXT        NOT NULL DEFAULT 'entered' CHECK (status IN ('entered','completed','withdrawn')),
  team_handicap         NUMERIC(5,1) NULL,                          -- result snapshot (rounded per the round's rule)
  team_handicap_record  JSONB       NULL,                           -- inputs + method + intermediate values, for transparent display/audit
  handicap_locked_at    TIMESTAMPTZ NULL,
  scorer_confirmed_at   TIMESTAMPTZ NULL,                           -- set only by assign_team_scorer(): the organiser must explicitly confirm the scorer
  drive_requirement_waived_at TIMESTAMPTZ NULL,                     -- organiser resolution of an unmet minimum-drive requirement (audited)
  submitted_at          TIMESTAMPTZ NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (round_id, team_id),
  UNIQUE (id, round_id)
);
CREATE INDEX IF NOT EXISTS round_team_entries_round_idx ON public.round_team_entries (round_id);

-- 4. Roster for that round. A player is in at most one team per round.
CREATE TABLE IF NOT EXISTS public.round_team_members (
  entry_id          UUID        NOT NULL,
  round_id          UUID        NOT NULL,
  player_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  position          SMALLINT    NOT NULL DEFAULT 0,
  handicap_snapshot NUMERIC(5,1) NULL,                              -- the player's playing handicap for this round (same source chain as scorecards.playing_handicap)
  PRIMARY KEY (entry_id, player_id),
  UNIQUE (round_id, player_id),
  FOREIGN KEY (entry_id, round_id) REFERENCES public.round_team_entries (id, round_id) ON DELETE CASCADE
);

-- 5. Current official team score per hole. `revision` is the concurrency token.
CREATE TABLE IF NOT EXISTS public.team_score_entries (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id         UUID        NOT NULL REFERENCES public.round_team_entries(id) ON DELETE CASCADE,
  hole_id          UUID        NOT NULL REFERENCES public.holes(id) ON DELETE CASCADE,
  gross_score      INTEGER     NULL,
  is_no_return     BOOLEAN     NOT NULL DEFAULT false,
  drive_player_id  UUID        NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  revision         INTEGER     NOT NULL DEFAULT 1 CHECK (revision >= 1),
  nr_treatment     TEXT        NULL,                                -- NULL while a No Return is unresolved; 'no_score' once the organiser has resolved it
  admin_overridden BOOLEAN     NOT NULL DEFAULT false,              -- true after an organiser override: the scorer is locked out of this hole
  updated_by       UUID        NOT NULL REFERENCES public.profiles(id),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entry_id, hole_id),
  CONSTRAINT team_score_nr_treatment_chk CHECK (nr_treatment IS NULL OR (is_no_return AND nr_treatment = 'no_score')),
  CONSTRAINT team_score_value_chk CHECK ((is_no_return AND gross_score IS NULL) OR (NOT is_no_return AND gross_score BETWEEN 1 AND 20))
);

-- 6. Append-only history of every accepted write (also the idempotency record: client_id is unique).
CREATE TABLE IF NOT EXISTS public.team_score_revisions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_score_id    UUID        NOT NULL REFERENCES public.team_score_entries(id) ON DELETE CASCADE,
  revision         INTEGER     NOT NULL,
  client_id        TEXT        NOT NULL UNIQUE,
  gross_score      INTEGER     NULL,
  is_no_return     BOOLEAN     NOT NULL,
  drive_player_id  UUID        NULL,
  actor_id         UUID        NOT NULL REFERENCES public.profiles(id),
  actor_role       TEXT        NOT NULL CHECK (actor_role IN ('scorer','organiser')),
  reason           TEXT        NULL,                                -- required for organiser writes (enforced in the function)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_score_id, revision)
);

-- 7. Team-member "something looks wrong" flags. A flag NEVER changes a score.
CREATE TABLE IF NOT EXISTS public.team_score_flags (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id         UUID        NOT NULL REFERENCES public.round_team_entries(id) ON DELETE CASCADE,
  hole_id          UUID        NOT NULL REFERENCES public.holes(id) ON DELETE CASCADE,
  against_revision INTEGER     NULL,
  raised_by        UUID        NOT NULL REFERENCES public.profiles(id),
  note             TEXT        NULL CHECK (note IS NULL OR length(note) <= 300),
  status           TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  raised_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_by      UUID        NULL REFERENCES public.profiles(id),
  resolved_at      TIMESTAMPTZ NULL,
  resolution_note  TEXT        NULL
);
CREATE INDEX IF NOT EXISTS team_score_flags_entry_idx ON public.team_score_flags (entry_id, status);

-- 8. History cannot be edited.
CREATE OR REPLACE FUNCTION public.team_score_revisions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'team_score_revisions rows cannot be edited'; END; $$;
DROP TRIGGER IF EXISTS team_score_revisions_no_change ON public.team_score_revisions;
CREATE TRIGGER team_score_revisions_no_change BEFORE UPDATE ON public.team_score_revisions
  FOR EACH ROW EXECUTE FUNCTION public.team_score_revisions_immutable();
-- Edits are blocked by the trigger. Deletes are not trigger-blocked so that deleting a whole trip/round still cascades; direct deletes are impossible
-- for browsers (no DELETE policy) and the API never issues them.

-- 9. WRITE PATHS (v2 security design). Every function derives the caller from auth.uid() and the caller's authority from the database
--    (is_trip_organiser(), nominated scorer, roster). NOTHING about identity or privilege is accepted as an argument.
--    Functions are executable by `authenticated` only (revoked from PUBLIC/anon/service_role); a caller with no JWT gets 'not_authenticated'.
--    The API must call them with the signed-in user's own client (not the service-role client). search_path is pinned (pg_temp last).

CREATE TABLE IF NOT EXISTS public.team_entry_audit (
  id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id  UUID        NOT NULL REFERENCES public.round_team_entries(id) ON DELETE CASCADE,
  hole_id   UUID        NULL REFERENCES public.holes(id) ON DELETE SET NULL,
  action    TEXT        NOT NULL CHECK (action IN ('scorer_assigned','override_lock_released','no_return_resolved','flag_resolved','drive_requirement_waived','entry_saved','handicap_locked','setup_reopened','setup_relocked')),
  actor_id  UUID        NOT NULL REFERENCES public.profiles(id),
  reason    TEXT        NULL,
  detail    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_entry_audit_entry_idx ON public.team_entry_audit (entry_id, at);

CREATE OR REPLACE FUNCTION public.submit_team_score(
  p_client_id text, p_entry_id uuid, p_hole_id uuid,
  p_gross integer, p_no_return boolean, p_drive uuid,
  p_base_revision integer, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  uid   uuid := auth.uid();
  e     public.round_team_entries%ROWTYPE;
  r     public.rounds%ROWTYPE;
  cur   public.team_score_entries%ROWTYPE;
  prior public.team_score_revisions%ROWTYPE;
  base  integer := COALESCE(p_base_revision, 0);
  is_org boolean;
  role  text;
  new_rev integer;
  tsid  uuid;
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('outcome','not_authenticated'); END IF;
  IF p_client_id IS NULL OR btrim(p_client_id) = '' OR length(p_client_id) > 100 THEN RETURN jsonb_build_object('outcome','invalid_value'); END IF;
  IF p_no_return IS NULL OR (p_no_return AND p_gross IS NOT NULL) THEN RETURN jsonb_build_object('outcome','invalid_value'); END IF;
  IF NOT p_no_return AND (p_gross IS NULL OR p_gross NOT BETWEEN 1 AND 20) THEN RETURN jsonb_build_object('outcome','invalid_value'); END IF;

  SELECT * INTO e FROM public.round_team_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
  SELECT * INTO r FROM public.rounds WHERE id = e.round_id;

  -- Authority is established BEFORE anything is revealed (including idempotent replays).
  is_org := public.is_trip_organiser(r.trip_id);          -- uses auth.uid(); an organiser of a different event is not an organiser here
  IF NOT is_org AND e.nominated_scorer_id IS DISTINCT FROM uid THEN RETURN jsonb_build_object('outcome','not_authorised'); END IF;
  IF NOT is_org AND e.scorer_confirmed_at IS NULL THEN RETURN jsonb_build_object('outcome','scorer_not_confirmed'); END IF;
  role := CASE WHEN is_org THEN 'organiser' ELSE 'scorer' END;

  SELECT * INTO prior FROM public.team_score_revisions WHERE client_id = p_client_id;
  IF FOUND THEN
    SELECT * INTO cur FROM public.team_score_entries WHERE id = prior.team_score_id;
    IF cur.entry_id <> e.id THEN RETURN jsonb_build_object('outcome','invalid_value'); END IF;   -- client_id already used for a different entry
    RETURN jsonb_build_object('outcome','duplicate','applied_revision',prior.revision,'revision',cur.revision,'gross_score',cur.gross_score,'is_no_return',cur.is_no_return);
  END IF;

  IF e.status = 'withdrawn' THEN RETURN jsonb_build_object('outcome','entry_withdrawn'); END IF;
  IF r.status = 'cancelled' OR (NOT is_org AND r.status <> 'active') THEN RETURN jsonb_build_object('outcome','round_closed'); END IF;
  IF is_org AND (p_reason IS NULL OR btrim(p_reason) = '') THEN RETURN jsonb_build_object('outcome','reason_required'); END IF;
  IF p_drive IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.round_team_members m WHERE m.entry_id = e.id AND m.player_id = p_drive) THEN
    RETURN jsonb_build_object('outcome','invalid_drive_player');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.holes h WHERE h.id = p_hole_id AND h.round_id = e.round_id) THEN RETURN jsonb_build_object('outcome','invalid_hole'); END IF;

  SELECT * INTO cur FROM public.team_score_entries WHERE entry_id = e.id AND hole_id = p_hole_id FOR UPDATE;
  IF NOT FOUND THEN
    IF base <> 0 THEN RETURN jsonb_build_object('outcome','invalid_base'); END IF;
    BEGIN
      INSERT INTO public.team_score_entries (entry_id, hole_id, gross_score, is_no_return, drive_player_id, revision, admin_overridden, updated_by)
      VALUES (e.id, p_hole_id, p_gross, p_no_return, p_drive, 1, is_org, uid) RETURNING id INTO tsid;
    EXCEPTION WHEN unique_violation THEN
      SELECT * INTO cur FROM public.team_score_entries WHERE entry_id = e.id AND hole_id = p_hole_id;
      RETURN jsonb_build_object('outcome','conflict','revision',cur.revision,'gross_score',cur.gross_score,'is_no_return',cur.is_no_return);
    END;
    INSERT INTO public.team_score_revisions (team_score_id, revision, client_id, gross_score, is_no_return, drive_player_id, actor_id, actor_role, reason)
    VALUES (tsid, 1, p_client_id, p_gross, p_no_return, p_drive, uid, role, p_reason);
    RETURN jsonb_build_object('outcome','inserted','revision',1,'gross_score',p_gross,'is_no_return',p_no_return);
  END IF;

  IF NOT is_org AND cur.admin_overridden THEN
    RETURN jsonb_build_object('outcome','locked','revision',cur.revision,'gross_score',cur.gross_score,'is_no_return',cur.is_no_return);
  END IF;
  IF base > cur.revision THEN RETURN jsonb_build_object('outcome','invalid_base','revision',cur.revision); END IF;
  IF base < cur.revision THEN
    IF cur.gross_score IS NOT DISTINCT FROM p_gross AND cur.is_no_return = p_no_return AND cur.drive_player_id IS NOT DISTINCT FROM p_drive THEN
      RETURN jsonb_build_object('outcome','duplicate','revision',cur.revision,'gross_score',cur.gross_score,'is_no_return',cur.is_no_return);
    END IF;
    RETURN jsonb_build_object('outcome','conflict','revision',cur.revision,'gross_score',cur.gross_score,'is_no_return',cur.is_no_return);
  END IF;

  new_rev := cur.revision + 1;
  UPDATE public.team_score_entries SET gross_score = p_gross, is_no_return = p_no_return, drive_player_id = p_drive, nr_treatment = NULL,
         revision = new_rev, admin_overridden = (cur.admin_overridden OR is_org), updated_by = uid, updated_at = now()
   WHERE id = cur.id;
  INSERT INTO public.team_score_revisions (team_score_id, revision, client_id, gross_score, is_no_return, drive_player_id, actor_id, actor_role, reason)
  VALUES (cur.id, new_rev, p_client_id, p_gross, p_no_return, p_drive, uid, role, p_reason);
  RETURN jsonb_build_object('outcome','updated','revision',new_rev,'gross_score',p_gross,'is_no_return',p_no_return);
END;
$$;

-- Organiser explicitly appoints (or re-appoints) the scorer. A suggestion may be pre-selected in the UI, but nothing scores until this runs.
CREATE OR REPLACE FUNCTION public.assign_team_scorer(p_entry_id uuid, p_scorer uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE uid uuid := auth.uid(); e public.round_team_entries%ROWTYPE; r public.rounds%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('outcome','not_authenticated'); END IF;
  SELECT * INTO e FROM public.round_team_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
  SELECT * INTO r FROM public.rounds WHERE id = e.round_id;
  IF NOT public.is_trip_organiser(r.trip_id) THEN RETURN jsonb_build_object('outcome','not_authorised'); END IF;
  IF e.status = 'withdrawn' THEN RETURN jsonb_build_object('outcome','entry_withdrawn'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.round_team_members m WHERE m.entry_id = e.id AND m.player_id = p_scorer) THEN RETURN jsonb_build_object('outcome','invalid_scorer'); END IF;
  UPDATE public.round_team_entries SET nominated_scorer_id = p_scorer, scorer_confirmed_at = now() WHERE id = e.id;
  INSERT INTO public.team_entry_audit (entry_id, action, actor_id, detail)
  VALUES (e.id, 'scorer_assigned', uid, jsonb_build_object('from', e.nominated_scorer_id, 'to', p_scorer));
  RETURN jsonb_build_object('outcome','assigned');
END; $$;

-- Organiser releases the scorer lock on one hole. The revision is advanced, so any submission queued against an older revision
-- (made before the override or before the release) becomes a conflict and cannot overwrite the accepted correction.
CREATE OR REPLACE FUNCTION public.release_team_override_lock(p_entry_id uuid, p_hole_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE uid uuid := auth.uid(); e public.round_team_entries%ROWTYPE; r public.rounds%ROWTYPE; cur public.team_score_entries%ROWTYPE; new_rev integer;
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('outcome','not_authenticated'); END IF;
  SELECT * INTO e FROM public.round_team_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
  SELECT * INTO r FROM public.rounds WHERE id = e.round_id;
  IF NOT public.is_trip_organiser(r.trip_id) THEN RETURN jsonb_build_object('outcome','not_authorised'); END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RETURN jsonb_build_object('outcome','reason_required'); END IF;
  SELECT * INTO cur FROM public.team_score_entries WHERE entry_id = e.id AND hole_id = p_hole_id FOR UPDATE;
  IF NOT FOUND OR NOT cur.admin_overridden THEN RETURN jsonb_build_object('outcome','not_locked'); END IF;
  new_rev := cur.revision + 1;
  UPDATE public.team_score_entries SET admin_overridden = false, revision = new_rev, updated_by = uid, updated_at = now() WHERE id = cur.id;
  INSERT INTO public.team_score_revisions (team_score_id, revision, client_id, gross_score, is_no_return, drive_player_id, actor_id, actor_role, reason)
  VALUES (cur.id, new_rev, 'unlock:' || gen_random_uuid()::text, cur.gross_score, cur.is_no_return, cur.drive_player_id, uid, 'organiser', p_reason);
  INSERT INTO public.team_entry_audit (entry_id, hole_id, action, actor_id, reason, detail)
  VALUES (e.id, p_hole_id, 'override_lock_released', uid, p_reason, jsonb_build_object('revision', new_rev));
  RETURN jsonb_build_object('outcome','released','revision',new_rev);
END; $$;

-- Organiser records "no score" treatment for an unresolved No Return (a capped/other score is an ordinary, reasoned organiser override instead).
CREATE OR REPLACE FUNCTION public.resolve_team_no_return(p_entry_id uuid, p_hole_id uuid, p_base_revision integer, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE uid uuid := auth.uid(); e public.round_team_entries%ROWTYPE; r public.rounds%ROWTYPE; cur public.team_score_entries%ROWTYPE; new_rev integer;
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('outcome','not_authenticated'); END IF;
  SELECT * INTO e FROM public.round_team_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
  SELECT * INTO r FROM public.rounds WHERE id = e.round_id;
  IF NOT public.is_trip_organiser(r.trip_id) THEN RETURN jsonb_build_object('outcome','not_authorised'); END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RETURN jsonb_build_object('outcome','reason_required'); END IF;
  SELECT * INTO cur FROM public.team_score_entries WHERE entry_id = e.id AND hole_id = p_hole_id FOR UPDATE;
  IF NOT FOUND OR NOT cur.is_no_return THEN RETURN jsonb_build_object('outcome','not_no_return'); END IF;
  IF COALESCE(p_base_revision, 0) <> cur.revision THEN RETURN jsonb_build_object('outcome','conflict','revision',cur.revision,'gross_score',cur.gross_score,'is_no_return',cur.is_no_return); END IF;
  new_rev := cur.revision + 1;
  UPDATE public.team_score_entries SET nr_treatment = 'no_score', admin_overridden = true, revision = new_rev, updated_by = uid, updated_at = now() WHERE id = cur.id;
  INSERT INTO public.team_score_revisions (team_score_id, revision, client_id, gross_score, is_no_return, drive_player_id, actor_id, actor_role, reason)
  VALUES (cur.id, new_rev, 'nr:' || gen_random_uuid()::text, NULL, true, cur.drive_player_id, uid, 'organiser', p_reason);
  INSERT INTO public.team_entry_audit (entry_id, hole_id, action, actor_id, reason, detail)
  VALUES (e.id, p_hole_id, 'no_return_resolved', uid, p_reason, jsonb_build_object('treatment','no_score','revision', new_rev));
  RETURN jsonb_build_object('outcome','resolved','revision',new_rev);
END; $$;

-- Any roster member of the entry (or the organiser) may flag a hole. A flag never changes a score.
CREATE OR REPLACE FUNCTION public.raise_team_score_flag(p_entry_id uuid, p_hole_id uuid, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE uid uuid := auth.uid(); e public.round_team_entries%ROWTYPE; r public.rounds%ROWTYPE; cur public.team_score_entries%ROWTYPE; fid uuid;
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('outcome','not_authenticated'); END IF;
  SELECT * INTO e FROM public.round_team_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
  SELECT * INTO r FROM public.rounds WHERE id = e.round_id;
  IF NOT (public.is_trip_organiser(r.trip_id) OR EXISTS (SELECT 1 FROM public.round_team_members m WHERE m.entry_id = e.id AND m.player_id = uid)) THEN
    RETURN jsonb_build_object('outcome','not_authorised');
  END IF;
  IF p_note IS NOT NULL AND length(p_note) > 300 THEN RETURN jsonb_build_object('outcome','invalid_value'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.holes h WHERE h.id = p_hole_id AND h.round_id = e.round_id) THEN RETURN jsonb_build_object('outcome','invalid_hole'); END IF;
  SELECT * INTO cur FROM public.team_score_entries WHERE entry_id = e.id AND hole_id = p_hole_id;
  INSERT INTO public.team_score_flags (entry_id, hole_id, against_revision, raised_by, note)
  VALUES (e.id, p_hole_id, cur.revision, uid, p_note) RETURNING id INTO fid;
  RETURN jsonb_build_object('outcome','flagged','flag_id',fid);
END; $$;

CREATE OR REPLACE FUNCTION public.resolve_team_score_flag(p_flag_id uuid, p_status text, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE uid uuid := auth.uid(); f public.team_score_flags%ROWTYPE; e public.round_team_entries%ROWTYPE; r public.rounds%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('outcome','not_authenticated'); END IF;
  IF p_status IS NULL OR p_status NOT IN ('resolved','dismissed') THEN RETURN jsonb_build_object('outcome','invalid_value'); END IF;
  SELECT * INTO f FROM public.team_score_flags WHERE id = p_flag_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
  SELECT * INTO e FROM public.round_team_entries WHERE id = f.entry_id;
  SELECT * INTO r FROM public.rounds WHERE id = e.round_id;
  IF NOT public.is_trip_organiser(r.trip_id) THEN RETURN jsonb_build_object('outcome','not_authorised'); END IF;
  IF f.status <> 'open' THEN RETURN jsonb_build_object('outcome','already_closed'); END IF;
  UPDATE public.team_score_flags SET status = p_status, resolved_by = uid, resolved_at = now(), resolution_note = p_note WHERE id = f.id;
  INSERT INTO public.team_entry_audit (entry_id, hole_id, action, actor_id, reason, detail)
  VALUES (e.id, f.hole_id, 'flag_resolved', uid, p_note, jsonb_build_object('flag_id', f.id, 'status', p_status));
  RETURN jsonb_build_object('outcome','closed');
END; $$;

CREATE OR REPLACE FUNCTION public.waive_team_drive_requirement(p_entry_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE uid uuid := auth.uid(); e public.round_team_entries%ROWTYPE; r public.rounds%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('outcome','not_authenticated'); END IF;
  SELECT * INTO e FROM public.round_team_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
  SELECT * INTO r FROM public.rounds WHERE id = e.round_id;
  IF NOT public.is_trip_organiser(r.trip_id) THEN RETURN jsonb_build_object('outcome','not_authorised'); END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RETURN jsonb_build_object('outcome','reason_required'); END IF;
  UPDATE public.round_team_entries SET drive_requirement_waived_at = now() WHERE id = e.id;
  INSERT INTO public.team_entry_audit (entry_id, action, actor_id, reason) VALUES (e.id, 'drive_requirement_waived', uid, p_reason);
  RETURN jsonb_build_object('outcome','waived');
END; $$;

-- Completion check (read-only, SECURITY INVOKER: RLS decides what the caller can see). Close must not silently convert incomplete scores into results.
CREATE OR REPLACE FUNCTION public.team_entry_completion(p_entry_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
  WITH e AS (SELECT * FROM public.round_team_entries WHERE id = p_entry_id),
  req AS (SELECT count(*)::int AS holes FROM public.holes h JOIN e ON h.round_id = e.round_id),
  sc  AS (SELECT count(*)::int AS rows_,
                 count(*) FILTER (WHERE s.is_no_return AND s.nr_treatment IS NULL)::int AS unresolved_nr,
                 count(*) FILTER (WHERE s.is_no_return AND s.nr_treatment = 'no_score')::int AS no_score_holes
            FROM public.team_score_entries s JOIN e ON s.entry_id = e.id),
  fl  AS (SELECT count(*)::int AS open_flags FROM public.team_score_flags f JOIN e ON f.entry_id = e.id WHERE f.status = 'open'),
  dr  AS (SELECT CASE WHEN c.min_drives_per_player IS NULL OR e.drive_requirement_waived_at IS NOT NULL THEN 0
                 ELSE (SELECT count(*)::int FROM public.round_team_members m
                        WHERE m.entry_id = e.id
                          AND (SELECT count(*) FROM public.team_score_entries s WHERE s.entry_id = e.id AND s.drive_player_id = m.player_id) < c.min_drives_per_player) END AS short_players
            FROM e LEFT JOIN public.round_competition_config c ON c.round_id = e.round_id)
  SELECT jsonb_build_object(
    'required_holes', req.holes, 'missing_holes', req.holes - sc.rows_, 'unresolved_no_returns', sc.unresolved_nr, 'no_score_holes', sc.no_score_holes,
    'open_flags', fl.open_flags, 'drive_shortfall_players', dr.short_players,
    'complete', (req.holes > 0 AND req.holes - sc.rows_ = 0 AND sc.unresolved_nr = 0 AND sc.no_score_holes = 0 AND fl.open_flags = 0 AND dr.short_players = 0))
  FROM req, sc, fl, dr
$$;


-- ---------------------------------------------------------------------------------------------------------------------------
-- ORGANISER SETUP FUNCTIONS (M2). Same pattern: identity from auth.uid(), authority from is_trip_organiser() of THAT trip. Nothing is
-- accepted from the caller about who they are. Setup is frozen once team scoring has started for the round.
-- ---------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_competition_team(p_trip_id uuid, p_name text, p_colour text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE uid uuid := auth.uid(); tid uuid;
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('outcome','not_authenticated'); END IF;
  IF NOT public.is_trip_organiser(p_trip_id) THEN RETURN jsonb_build_object('outcome','not_authorised'); END IF;
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 60 THEN RETURN jsonb_build_object('outcome','invalid_value'); END IF;
  BEGIN
    INSERT INTO public.competition_teams (trip_id, name, colour, created_by) VALUES (p_trip_id, btrim(p_name), p_colour, uid) RETURNING id INTO tid;
  EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('outcome','duplicate_name');
  END;
  RETURN jsonb_build_object('outcome','created','team_id',tid);
END; $$;

-- Freeze boundary (approved): team set-up (format, roster, handicap) is locked from ROUND RELEASE (rounds.setup_released = true, set by Confirm & Release, migration 062/101; Begin Round later sets status 'active', which also locks) and strictly locked once any
-- score exists. A released round can be reopened ONLY by reopen_team_setup() (organiser, reason, audited) and only while no score exists.
-- Scorer reassignment (assign_team_scorer) deliberately stays available after release (a scorer's phone can die mid-round); it is audited every time.
-- Internal helper: called only from the SECURITY DEFINER functions below; not callable by any client role.
CREATE OR REPLACE FUNCTION public.team_setup_block(p_round_id uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.team_score_entries s JOIN public.round_team_entries e ON e.id = s.entry_id WHERE e.round_id = p_round_id) THEN 'scoring_started'
    WHEN (SELECT (r.status <> 'upcoming' OR COALESCE(r.setup_released, false)) FROM public.rounds r WHERE r.id = p_round_id)
         AND NOT COALESCE((SELECT c.setup_reopened_at IS NOT NULL FROM public.round_competition_config c WHERE c.round_id = p_round_id), false) THEN 'setup_locked'
    ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION public.configure_round_competition(p_round_id uuid, p_format text, p_method text, p_params jsonb, p_min_drives integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE uid uuid := auth.uid(); r public.rounds%ROWTYPE; size smallint; blk text;
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('outcome','not_authenticated'); END IF;
  SELECT * INTO r FROM public.rounds WHERE id = p_round_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
  IF NOT public.is_trip_organiser(r.trip_id) THEN RETURN jsonb_build_object('outcome','not_authorised'); END IF;
  IF r.status IN ('completed','cancelled') THEN RETURN jsonb_build_object('outcome','round_closed'); END IF;
  size := CASE p_format WHEN 'ambrose_2' THEN 2 WHEN 'ambrose_4' THEN 4 ELSE NULL END;
  IF size IS NULL OR p_method NOT IN ('gross_only','club_divisor','weighted_scramble','organiser_entered') THEN RETURN jsonb_build_object('outcome','invalid_value'); END IF;
  IF p_min_drives IS NOT NULL AND p_min_drives NOT BETWEEN 0 AND 18 THEN RETURN jsonb_build_object('outcome','invalid_value'); END IF;
  blk := public.team_setup_block(p_round_id);
  IF blk IS NOT NULL THEN RETURN jsonb_build_object('outcome', blk); END IF;
  INSERT INTO public.round_competition_config (round_id, format, team_size, handicap_method, handicap_params, min_drives_per_player, created_by)
  VALUES (p_round_id, p_format, size, p_method, COALESCE(p_params, '{}'::jsonb), p_min_drives, uid)
  ON CONFLICT (round_id) DO UPDATE SET format = EXCLUDED.format, team_size = EXCLUDED.team_size, handicap_method = EXCLUDED.handicap_method,
         handicap_params = EXCLUDED.handicap_params, min_drives_per_player = EXCLUDED.min_drives_per_player;
  RETURN jsonb_build_object('outcome','configured');
END; $$;

-- Create or replace a team's roster for a round. Exactly team_size players, all members of the trip, none already in another team this round.
-- The scorer is NOT set here (explicit organiser confirmation is assign_team_scorer); changing the roster clears a scorer who is no longer on it.
CREATE OR REPLACE FUNCTION public.save_round_team_entry(p_round_id uuid, p_team_id uuid, p_members uuid[], p_group_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE uid uuid := auth.uid(); r public.rounds%ROWTYPE; cfg public.round_competition_config%ROWTYPE; t public.competition_teams%ROWTYPE; blk text;
        e public.round_team_entries%ROWTYPE; m uuid; pos smallint := 0; n int;
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('outcome','not_authenticated'); END IF;
  SELECT * INTO r FROM public.rounds WHERE id = p_round_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
  IF NOT public.is_trip_organiser(r.trip_id) THEN RETURN jsonb_build_object('outcome','not_authorised'); END IF;
  IF r.status IN ('completed','cancelled') THEN RETURN jsonb_build_object('outcome','round_closed'); END IF;
  SELECT * INTO cfg FROM public.round_competition_config WHERE round_id = p_round_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_configured'); END IF;
  -- a locked set-up is locked, whatever else is wrong with the request
  blk := public.team_setup_block(p_round_id);
  IF blk IS NOT NULL THEN RETURN jsonb_build_object('outcome', blk); END IF;
  SELECT * INTO t FROM public.competition_teams WHERE id = p_team_id AND trip_id = r.trip_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','team_not_in_event'); END IF;
  n := COALESCE(cardinality(p_members), 0);
  IF n <> cfg.team_size OR (SELECT count(DISTINCT x) FROM unnest(p_members) x) <> n THEN RETURN jsonb_build_object('outcome','wrong_team_size'); END IF;
  FOREACH m IN ARRAY p_members LOOP
    IF NOT EXISTS (SELECT 1 FROM public.trip_members tm WHERE tm.trip_id = r.trip_id AND tm.profile_id = m) THEN RETURN jsonb_build_object('outcome','not_trip_member'); END IF;
    IF EXISTS (SELECT 1 FROM public.round_team_members x JOIN public.round_team_entries xe ON xe.id = x.entry_id WHERE x.round_id = p_round_id AND x.player_id = m AND xe.team_id <> p_team_id) THEN
      RETURN jsonb_build_object('outcome','player_in_other_team');
    END IF;
  END LOOP;
  IF p_group_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.trip_groups g WHERE g.id = p_group_id AND g.trip_id = r.trip_id) THEN RETURN jsonb_build_object('outcome','group_not_in_event'); END IF;

  SELECT * INTO e FROM public.round_team_entries WHERE round_id = p_round_id AND team_id = p_team_id FOR UPDATE;
  IF FOUND THEN
    DELETE FROM public.round_team_members WHERE entry_id = e.id;
    UPDATE public.round_team_entries SET group_id = p_group_id, entry_name = t.name,
           nominated_scorer_id = CASE WHEN nominated_scorer_id = ANY (p_members) THEN nominated_scorer_id ELSE NULL END,
           scorer_confirmed_at = CASE WHEN nominated_scorer_id = ANY (p_members) THEN scorer_confirmed_at ELSE NULL END,
           team_handicap = NULL, team_handicap_record = NULL, handicap_locked_at = NULL      -- a changed roster invalidates a locked handicap
     WHERE id = e.id;
  ELSE
    INSERT INTO public.round_team_entries (round_id, team_id, entry_name, group_id) VALUES (p_round_id, p_team_id, t.name, p_group_id) RETURNING * INTO e;
  END IF;
  FOREACH m IN ARRAY p_members LOOP
    pos := pos + 1;
    INSERT INTO public.round_team_members (entry_id, round_id, player_id, position) VALUES (e.id, p_round_id, m, pos);
  END LOOP;
  INSERT INTO public.team_entry_audit (entry_id, action, actor_id, detail) VALUES (e.id, 'entry_saved', uid, jsonb_build_object('members', to_jsonb(p_members)));
  RETURN jsonb_build_object('outcome','saved','entry_id',e.id);
END; $$;

-- Stores the team handicap snapshot the app calculated (or the organiser typed). The database cannot recompute the allowance, so it
-- checks only what it can: organiser authority, round open, no scores yet, method matches the round config, sane range, roster matches the record.
CREATE OR REPLACE FUNCTION public.lock_team_handicap(p_entry_id uuid, p_team_handicap numeric, p_record jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE uid uuid := auth.uid(); e public.round_team_entries%ROWTYPE; r public.rounds%ROWTYPE; cfg public.round_competition_config%ROWTYPE; rec_players int; blk text;
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('outcome','not_authenticated'); END IF;
  SELECT * INTO e FROM public.round_team_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
  SELECT * INTO r FROM public.rounds WHERE id = e.round_id;
  IF NOT public.is_trip_organiser(r.trip_id) THEN RETURN jsonb_build_object('outcome','not_authorised'); END IF;
  IF r.status IN ('completed','cancelled') THEN RETURN jsonb_build_object('outcome','round_closed'); END IF;
  blk := public.team_setup_block(e.round_id);
  IF blk IS NOT NULL THEN RETURN jsonb_build_object('outcome', blk); END IF;
  SELECT * INTO cfg FROM public.round_competition_config WHERE round_id = e.round_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_configured'); END IF;
  IF p_team_handicap IS NULL OR p_team_handicap < -10 OR p_team_handicap > 100 OR p_team_handicap <> round(p_team_handicap, 1) THEN RETURN jsonb_build_object('outcome','invalid_value'); END IF;
  IF p_record IS NULL OR jsonb_typeof(p_record) <> 'object' OR p_record->>'method' IS NULL THEN RETURN jsonb_build_object('outcome','invalid_value'); END IF;
  IF cfg.handicap_method = 'gross_only' THEN RETURN jsonb_build_object('outcome','method_mismatch'); END IF;   -- a gross-only round has no allowance to lock
  IF (CASE p_record->>'method' WHEN 'ga_weighted' THEN 'weighted_scramble' ELSE p_record->>'method' END) <> cfg.handicap_method THEN RETURN jsonb_build_object('outcome','method_mismatch'); END IF;
  IF cfg.handicap_method <> 'organiser_entered' THEN
    rec_players := COALESCE(jsonb_array_length(p_record->'players'), 0);
    IF rec_players <> cfg.team_size THEN RETURN jsonb_build_object('outcome','roster_mismatch'); END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_record->'players') pl WHERE NOT EXISTS (SELECT 1 FROM public.round_team_members m WHERE m.entry_id = e.id AND m.player_id::text = pl->>'playerId')) THEN
      RETURN jsonb_build_object('outcome','roster_mismatch');
    END IF;
  END IF;
  UPDATE public.round_team_entries SET team_handicap = p_team_handicap, team_handicap_record = p_record, handicap_locked_at = now() WHERE id = e.id;
  INSERT INTO public.team_entry_audit (entry_id, action, actor_id, detail) VALUES (e.id, 'handicap_locked', uid, jsonb_build_object('team_handicap', p_team_handicap, 'method', p_record->>'method'));
  RETURN jsonb_build_object('outcome','handicap_locked');
END; $$;

-- Reopen / re-lock a RELEASED round's team set-up. Organiser only, reason required, audited on every team entry; refused once any score exists.
CREATE OR REPLACE FUNCTION public.reopen_team_setup(p_round_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE uid uuid := auth.uid(); r public.rounds%ROWTYPE; cfg public.round_competition_config%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('outcome','not_authenticated'); END IF;
  SELECT * INTO r FROM public.rounds WHERE id = p_round_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
  IF NOT public.is_trip_organiser(r.trip_id) THEN RETURN jsonb_build_object('outcome','not_authorised'); END IF;
  IF r.status IN ('completed','cancelled') THEN RETURN jsonb_build_object('outcome','round_closed'); END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' OR length(p_reason) > 300 THEN RETURN jsonb_build_object('outcome','reason_required'); END IF;
  SELECT * INTO cfg FROM public.round_competition_config WHERE round_id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_configured'); END IF;
  IF EXISTS (SELECT 1 FROM public.team_score_entries s JOIN public.round_team_entries e ON e.id = s.entry_id WHERE e.round_id = p_round_id) THEN RETURN jsonb_build_object('outcome','scoring_started'); END IF;
  IF (r.status = 'upcoming' AND NOT COALESCE(r.setup_released, false)) OR cfg.setup_reopened_at IS NOT NULL THEN RETURN jsonb_build_object('outcome','setup_not_locked'); END IF;
  UPDATE public.round_competition_config SET setup_reopened_at = now(), setup_reopened_by = uid WHERE round_id = p_round_id;
  INSERT INTO public.team_entry_audit (entry_id, action, actor_id, reason) SELECT e.id, 'setup_reopened', uid, btrim(p_reason) FROM public.round_team_entries e WHERE e.round_id = p_round_id;
  RETURN jsonb_build_object('outcome','reopened');
END; $$;

CREATE OR REPLACE FUNCTION public.relock_team_setup(p_round_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE uid uuid := auth.uid(); r public.rounds%ROWTYPE; cfg public.round_competition_config%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('outcome','not_authenticated'); END IF;
  SELECT * INTO r FROM public.rounds WHERE id = p_round_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
  IF NOT public.is_trip_organiser(r.trip_id) THEN RETURN jsonb_build_object('outcome','not_authorised'); END IF;
  SELECT * INTO cfg FROM public.round_competition_config WHERE round_id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_configured'); END IF;
  IF cfg.setup_reopened_at IS NULL THEN RETURN jsonb_build_object('outcome','setup_not_reopened'); END IF;
  UPDATE public.round_competition_config SET setup_reopened_at = NULL, setup_reopened_by = NULL WHERE round_id = p_round_id;
  INSERT INTO public.team_entry_audit (entry_id, action, actor_id) SELECT e.id, 'setup_relocked', uid FROM public.round_team_entries e WHERE e.round_id = p_round_id;
  RETURN jsonb_build_object('outcome','relocked');
END; $$;

-- Privileges: browsers (anon) and the service role cannot call the write paths; signed-in users can, and the functions authorise themselves.
REVOKE ALL ON FUNCTION public.submit_team_score(text,uuid,uuid,integer,boolean,uuid,integer,text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.assign_team_scorer(uuid,uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.release_team_override_lock(uuid,uuid,text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.resolve_team_no_return(uuid,uuid,integer,text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.raise_team_score_flag(uuid,uuid,text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.resolve_team_score_flag(uuid,text,text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.waive_team_drive_requirement(uuid,text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.team_entry_completion(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.submit_team_score(text,uuid,uuid,integer,boolean,uuid,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_team_scorer(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_team_override_lock(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_team_no_return(uuid,uuid,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.raise_team_score_flag(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_team_score_flag(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.waive_team_drive_requirement(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_entry_completion(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.create_competition_team(uuid,text,text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.configure_round_competition(uuid,text,text,jsonb,integer) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.save_round_team_entry(uuid,uuid,uuid[],uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.lock_team_handicap(uuid,numeric,jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.reopen_team_setup(uuid,text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.relock_team_setup(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.team_setup_block(uuid) FROM PUBLIC, anon, authenticated, service_role;   -- internal helper
GRANT EXECUTE ON FUNCTION public.create_competition_team(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.configure_round_competition(uuid,text,text,jsonb,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_round_team_entry(uuid,uuid,uuid[],uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lock_team_handicap(uuid,numeric,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_team_setup(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.relock_team_setup(uuid) TO authenticated;

-- 10. Row level security: members READ; nobody writes directly (no INSERT/UPDATE/DELETE policies). Organisers manage teams/entries through the API.
ALTER TABLE public.competition_teams       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.round_competition_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.round_team_entries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.round_team_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_score_entries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_score_revisions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_score_flags        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_entry_audit        ENABLE ROW LEVEL SECURITY;
-- Defence in depth: no direct writes for browsers even if a platform default grant exists. All writes go through the functions above.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.competition_teams, public.round_competition_config, public.round_team_entries, public.round_team_members,
  public.team_score_entries, public.team_score_revisions, public.team_score_flags, public.team_entry_audit FROM anon, authenticated;
REVOKE SELECT ON public.team_score_revisions, public.team_entry_audit FROM anon;

DROP POLICY IF EXISTS "competition_teams: members read" ON public.competition_teams;
CREATE POLICY "competition_teams: members read" ON public.competition_teams FOR SELECT USING (public.is_trip_member(trip_id));
DROP POLICY IF EXISTS "round_competition_config: members read" ON public.round_competition_config;
CREATE POLICY "round_competition_config: members read" ON public.round_competition_config FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.rounds r WHERE r.id = round_competition_config.round_id AND public.is_trip_member(r.trip_id)));
DROP POLICY IF EXISTS "round_team_entries: members read" ON public.round_team_entries;
CREATE POLICY "round_team_entries: members read" ON public.round_team_entries FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.rounds r WHERE r.id = round_team_entries.round_id AND public.is_trip_member(r.trip_id)));
DROP POLICY IF EXISTS "round_team_members: members read" ON public.round_team_members;
CREATE POLICY "round_team_members: members read" ON public.round_team_members FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.rounds r WHERE r.id = round_team_members.round_id AND public.is_trip_member(r.trip_id)));
DROP POLICY IF EXISTS "team_score_entries: members read" ON public.team_score_entries;
CREATE POLICY "team_score_entries: members read" ON public.team_score_entries FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.round_team_entries e JOIN public.rounds r ON r.id = e.round_id WHERE e.id = team_score_entries.entry_id AND public.is_trip_member(r.trip_id)));
DROP POLICY IF EXISTS "team_score_revisions: organiser read" ON public.team_score_revisions;
CREATE POLICY "team_score_revisions: organiser read" ON public.team_score_revisions FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.team_score_entries s JOIN public.round_team_entries e ON e.id = s.entry_id JOIN public.rounds r ON r.id = e.round_id
                 WHERE s.id = team_score_revisions.team_score_id AND public.is_trip_organiser(r.trip_id)));
DROP POLICY IF EXISTS "team_score_flags: entry members and organiser read" ON public.team_score_flags;
CREATE POLICY "team_score_flags: entry members and organiser read" ON public.team_score_flags FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.round_team_entries e JOIN public.rounds r ON r.id = e.round_id
                 WHERE e.id = team_score_flags.entry_id AND (public.is_trip_organiser(r.trip_id)
                   OR EXISTS (SELECT 1 FROM public.round_team_members m WHERE m.entry_id = e.id AND m.player_id = auth.uid()))));

DROP POLICY IF EXISTS "team_entry_audit: organiser read" ON public.team_entry_audit;
CREATE POLICY "team_entry_audit: organiser read" ON public.team_entry_audit FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.round_team_entries e JOIN public.rounds r ON r.id = e.round_id WHERE e.id = team_entry_audit.entry_id AND public.is_trip_organiser(r.trip_id)));


-- ROLLBACK (only new objects; run in this order):
--   DROP FUNCTION IF EXISTS public.reopen_team_setup(uuid,text), public.relock_team_setup(uuid), public.team_setup_block(uuid), public.lock_team_handicap(uuid,numeric,jsonb), public.save_round_team_entry(uuid,uuid,uuid[],uuid), public.configure_round_competition(uuid,text,text,jsonb,integer), public.create_competition_team(uuid,text,text),
--     public.team_entry_completion(uuid), public.waive_team_drive_requirement(uuid,text), public.resolve_team_score_flag(uuid,text,text),
--     public.raise_team_score_flag(uuid,uuid,text), public.resolve_team_no_return(uuid,uuid,integer,text), public.release_team_override_lock(uuid,uuid,text),
--     public.assign_team_scorer(uuid,uuid), public.submit_team_score(text,uuid,uuid,integer,boolean,uuid,integer,text);
--   DROP TABLE IF EXISTS public.team_entry_audit, public.team_score_flags, public.team_score_revisions, public.team_score_entries,
--                        public.round_team_members, public.round_team_entries, public.round_competition_config, public.competition_teams CASCADE;
--   DROP FUNCTION IF EXISTS public.team_score_revisions_immutable();

COMMIT;
