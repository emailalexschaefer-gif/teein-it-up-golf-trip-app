-- =============================================================================
-- 037_side_competitions_powerplay.sql
-- =============================================================================
-- Sprint 9 — Side Competitions (Nearest the Pin / Longest Drive / Pro's
-- Approach / Powerplay) + the leadership-history foundation for Event Story.
--
-- CORRECTED before first successful production deploy: the live smoke test
-- failed with "Could not find the 'powerplay_hole_number' column of
-- 'rounds'" — confirming this migration had NOT actually landed against
-- the production Supabase project. At the same time, a real product
-- requirement surfaced: a round must be able to hold MULTIPLE instances
-- of the same competition (two NTPs on different holes, two Powerplay
-- holes, etc.). Since nothing in production depends on the original
-- shape of this migration yet, it is corrected here directly rather than
-- shipping the wrong shape and immediately migrating away from it.
--
-- What changed from the first version of this migration:
--   - rounds.powerplay_hole_number is GONE. Powerplay is now just another
--     side_comps row (comp_type = 'powerplay'), the same round-scoped
--     competition-instance model as NTP/Longest Drive/Pro's Approach —
--     not a special single-column case. This is what makes multiple
--     Powerplay holes possible with no extra schema.
--   - UNIQUE(round_id, comp_type) -> UNIQUE(round_id, comp_type,
--     hole_number). The old constraint made "one NTP per round"
--     structural; the new one only prevents the same competition being
--     added twice to the same hole, which is the actual invariant that
--     should hold.
--   - The lock trigger that used to separately guard
--     rounds.powerplay_hole_number is removed -- Powerplay is a side_comps
--     row now, so the existing side_comps lock trigger already covers it.
--     One lock mechanism for every competition type, not two.
--
-- Everything else -- side_comp_entries (current, correctable result per
-- player), side_comp_lead_changes (append-only leadership history), the
-- row-locking RPC pattern, and the non-destructive handling of the
-- dormant pre-Sprint-9 side_comps/side_comp_results tables -- is
-- unchanged from the original design and reasoning.
-- =============================================================================

-- --- 1. side_comps -- the competition-instance table -------------------------
--
-- Defensive, not assumed: this table is confirmed unused by any
-- application code today (searched the entire codebase before writing
-- this migration), so in practice it should be empty in any real
-- deployment -- and the live error confirms this migration never actually
-- ran against production, so there is no Sprint-9-created data to
-- consider either. But ALTER COLUMN ... SET NOT NULL fails outright if
-- even one existing row has a NULL round_id, and the new
-- UNIQUE(round_id, comp_type, hole_number) constraint below would fail
-- if any two existing rows collide on it -- either would abort this
-- entire migration partway through. Rather than assume the table is
-- empty and let a surprise abort take down the deployment, both cases
-- are handled explicitly first, and per the explicit "preserve data if
-- there is any uncertainty" instruction, anything found is backed up
-- before removal, not simply deleted, with a RAISE NOTICE so a deploy
-- log makes it obvious if this branch ever actually fires.

CREATE TABLE IF NOT EXISTS public.side_comps_pre_sprint9_backup (LIKE public.side_comps INCLUDING ALL);

DO $$
DECLARE
  v_null_round_count INTEGER;
  v_dup_count        INTEGER;
BEGIN
  INSERT INTO public.side_comps_pre_sprint9_backup
    SELECT * FROM public.side_comps WHERE round_id IS NULL;
  GET DIAGNOSTICS v_null_round_count = ROW_COUNT;
  DELETE FROM public.side_comps WHERE round_id IS NULL;

  -- Duplicate check now matches the NEW uniqueness rule
  -- (round_id, comp_type, hole_number), not the old (round_id, comp_type)
  -- -- a dormant row only counts as a "duplicate" if it collides on all
  -- three, consistent with what the constraint below will actually
  -- enforce going forward.
  INSERT INTO public.side_comps_pre_sprint9_backup
    SELECT sc.* FROM public.side_comps sc
    WHERE EXISTS (
      SELECT 1 FROM public.side_comps sc2
      WHERE sc2.round_id = sc.round_id AND sc2.comp_type = sc.comp_type
        AND sc2.hole_number IS NOT DISTINCT FROM sc.hole_number
        AND sc2.id <> sc.id
        AND sc2.id > sc.id
    );
  GET DIAGNOSTICS v_dup_count = ROW_COUNT;
  DELETE FROM public.side_comps sc
    WHERE EXISTS (
      SELECT 1 FROM public.side_comps sc2
      WHERE sc2.round_id = sc.round_id AND sc2.comp_type = sc.comp_type
        AND sc2.hole_number IS NOT DISTINCT FROM sc.hole_number
        AND sc2.id <> sc.id AND sc2.id > sc.id
    );

  IF v_null_round_count > 0 OR v_dup_count > 0 THEN
    RAISE NOTICE 'Sprint 9 migration: moved % row(s) with NULL round_id and % duplicate (round_id, comp_type, hole_number) row(s) to side_comps_pre_sprint9_backup before applying new constraints. Review that table.', v_null_round_count, v_dup_count;
  END IF;
END $$;

ALTER TABLE public.side_comps
  ALTER COLUMN round_id SET NOT NULL;

ALTER TABLE public.side_comps
  DROP CONSTRAINT IF EXISTS side_comps_comp_type_check;
ALTER TABLE public.side_comps
  ADD CONSTRAINT side_comps_comp_type_check
  CHECK (comp_type IN ('nearest_pin','longest_drive','pros_approach','powerplay','best_on_day','custom'));

ALTER TABLE public.side_comps
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;

-- Drop the old one-per-type constraint if it somehow already exists from
-- a partial prior run, and replace it with the corrected rule: this only
-- prevents the exact same competition being added twice to the exact
-- same hole. Two NTPs on different holes, two Powerplay holes, multiple
-- Longest Drives -- all explicitly allowed now.
ALTER TABLE public.side_comps
  DROP CONSTRAINT IF EXISTS side_comps_round_type_unique;
ALTER TABLE public.side_comps
  ADD CONSTRAINT side_comps_round_type_hole_unique UNIQUE (round_id, comp_type, hole_number);

-- --- 2. side_comp_entries -- current, correctable result per player ----------
-- Never written for comp_type = 'powerplay' -- Powerplay isn't a
-- player-submitted competition, it's a scoring modifier read directly by
-- compute_stableford() below. Enforced at the application layer (the
-- entries API route only ever resolves a comp_type of nearest_pin/
-- longest_drive/pros_approach), not by a CHECK constraint here, since
-- this table's own shape has no reason to know about Powerplay at all.

CREATE TABLE IF NOT EXISTS public.side_comp_entries (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  side_comp_id  UUID        NOT NULL REFERENCES public.side_comps(id) ON DELETE CASCADE,
  player_id     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  qualified     BOOLEAN     NOT NULL,
  result_value  NUMERIC(6,2),
  moment_id     UUID        REFERENCES public.moments(id) ON DELETE SET NULL,
  entered_by    UUID        NOT NULL REFERENCES public.profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (side_comp_id, player_id),
  CHECK (qualified = true OR result_value IS NULL)
);

CREATE INDEX IF NOT EXISTS side_comp_entries_side_comp_id_idx ON public.side_comp_entries(side_comp_id);

DROP TRIGGER IF EXISTS side_comp_entries_updated_at ON public.side_comp_entries;
CREATE TRIGGER side_comp_entries_updated_at
  BEFORE UPDATE ON public.side_comp_entries
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- --- 3. side_comp_lead_changes -- append-only leadership history -------------
-- Unchanged from the original design: written exactly once per genuine
-- leadership change, by the API route, inside the same transaction as
-- the side_comp_entries upsert. Keyed entirely by side_comp_id -- a
-- second NTP on a different hole is a completely separate side_comp_id
-- with its own independent history, never mixed with the first.

CREATE TABLE IF NOT EXISTS public.side_comp_lead_changes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  side_comp_id    UUID        NOT NULL REFERENCES public.side_comps(id) ON DELETE CASCADE,
  player_id       UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  result_value    NUMERIC(6,2) NOT NULL,
  moment_id       UUID        REFERENCES public.moments(id) ON DELETE SET NULL,
  sequence_number INTEGER     NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (side_comp_id, sequence_number)
);

CREATE INDEX IF NOT EXISTS side_comp_lead_changes_side_comp_id_idx ON public.side_comp_lead_changes(side_comp_id, sequence_number);

-- --- 4. Lock configuration once the round leaves 'upcoming' ------------------
-- One trigger, one mechanism, for every competition type including
-- Powerplay now -- there is no longer a separate rounds.powerplay_hole_
-- number to guard with its own trigger.

CREATE OR REPLACE FUNCTION public.enforce_round_config_lock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_round_id UUID;
  v_status   TEXT;
BEGIN
  v_round_id := COALESCE(NEW.round_id, OLD.round_id);
  SELECT status INTO v_status FROM public.rounds WHERE id = v_round_id;
  IF v_status IS DISTINCT FROM 'upcoming' THEN
    RAISE EXCEPTION 'Side Competition configuration is locked once the round has started.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS side_comps_lock_after_start ON public.side_comps;
CREATE TRIGGER side_comps_lock_after_start
  BEFORE INSERT OR UPDATE OR DELETE ON public.side_comps
  FOR EACH ROW EXECUTE FUNCTION public.enforce_round_config_lock();

-- --- 5. Powerplay in the existing, authoritative Stableford trigger ---------
-- The ONLY place stableford_pts is ever multiplied -- every leaderboard,
-- cumulative-standings, and Final Results query already just reads the
-- stored value, so nothing downstream needs to know Powerplay exists.
-- Now checks side_comps directly (comp_type = 'powerplay', enabled,
-- matching this exact hole_number) instead of a single rounds column --
-- this is what makes multiple independent Powerplay holes in one round
-- work with zero special-casing: each one is just a row that either
-- matches this score entry's hole or doesn't. calculate_stableford_
-- points() itself (the pure formula) is intentionally NOT changed -- the
-- multiplier is applied to its result here, in the trigger that already
-- joins holes/scorecards, keeping the pure formula function reusable/
-- testable on its own (mirrored by the equivalent optional parameter on
-- the TS domain function, see src/lib/scoring/stableford.ts).

CREATE OR REPLACE FUNCTION public.compute_stableford()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_par        INTEGER; v_si INTEGER; v_hc INTEGER;
  v_hole_no    INTEGER; v_round_id UUID;
  v_base       INTEGER;
  v_is_pp_hole BOOLEAN;
BEGIN
  SELECT par, stroke_index, hole_number, round_id
    INTO v_par, v_si, v_hole_no, v_round_id
    FROM public.holes WHERE id = NEW.hole_id;
  SELECT playing_handicap INTO v_hc FROM public.scorecards WHERE id = NEW.scorecard_id;

  SELECT EXISTS (
    SELECT 1 FROM public.side_comps
    WHERE round_id = v_round_id AND comp_type = 'powerplay'
      AND enabled = true AND hole_number = v_hole_no
  ) INTO v_is_pp_hole;

  v_base := CASE WHEN NEW.is_no_return THEN 0
    ELSE public.calculate_stableford_points(NEW.gross_score, v_par, v_si, v_hc) END;

  NEW.stableford_pts := CASE WHEN v_is_pp_hole THEN v_base * 2 ELSE v_base END;
  RETURN NEW;
END;
$$;

-- --- 6. RLS -------------------------------------------------------------------

ALTER TABLE public.side_comp_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members: view entries" ON public.side_comp_entries;
CREATE POLICY "Members: view entries" ON public.side_comp_entries FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.side_comps sc WHERE sc.id = side_comp_entries.side_comp_id AND public.is_trip_member(sc.trip_id)));
DROP POLICY IF EXISTS "Players: insert own entry" ON public.side_comp_entries;
CREATE POLICY "Players: insert own entry" ON public.side_comp_entries FOR INSERT
  WITH CHECK (entered_by = auth.uid() AND player_id = auth.uid());
DROP POLICY IF EXISTS "Players: update own entry" ON public.side_comp_entries;
CREATE POLICY "Players: update own entry" ON public.side_comp_entries FOR UPDATE
  USING (player_id = auth.uid());
DROP POLICY IF EXISTS "Organisers: manage entries" ON public.side_comp_entries;
CREATE POLICY "Organisers: manage entries" ON public.side_comp_entries FOR ALL
  USING (EXISTS (SELECT 1 FROM public.side_comps sc WHERE sc.id = side_comp_entries.side_comp_id AND public.is_trip_organiser(sc.trip_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.side_comps sc WHERE sc.id = side_comp_entries.side_comp_id AND public.is_trip_organiser(sc.trip_id)));

ALTER TABLE public.side_comp_lead_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members: view lead changes" ON public.side_comp_lead_changes;
CREATE POLICY "Members: view lead changes" ON public.side_comp_lead_changes FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.side_comps sc WHERE sc.id = side_comp_lead_changes.side_comp_id AND public.is_trip_member(sc.trip_id)));
DROP POLICY IF EXISTS "Organisers: manage lead changes" ON public.side_comp_lead_changes;
CREATE POLICY "Organisers: manage lead changes" ON public.side_comp_lead_changes FOR ALL
  USING (EXISTS (SELECT 1 FROM public.side_comps sc WHERE sc.id = side_comp_lead_changes.side_comp_id AND public.is_trip_organiser(sc.trip_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.side_comps sc WHERE sc.id = side_comp_lead_changes.side_comp_id AND public.is_trip_organiser(sc.trip_id)));
