-- =============================================================================
-- 037_side_competitions_powerplay.sql
-- =============================================================================
-- Sprint 9 — Side Competitions (Nearest the Pin / Longest Drive / Pro's
-- Approach) + Powerplay + the leadership-history foundation for Event Story.
--
-- Investigated before writing this (see delivery notes for the full
-- report): `side_comps` / `side_comp_results` already exist (migration
-- 005) but are completely unused anywhere in application code — a
-- dormant, differently-shaped V0 attempt (organiser manually types in a
-- free-text winner, no round_id requirement, no numeric comparison, no
-- leadership history). Per explicit instruction, this migration does NOT
-- drop or destructively alter `side_comp_results` — it is left exactly
-- as-is in case it holds any production data that hasn't been confirmed
-- empty. `side_comps` itself IS altered (not dropped) since its shape
-- (round_id, comp_type, hole_number) is fundamentally the right shape,
-- just needs round_id enforced and comp_type widened.
--
-- Two architectural decisions made explicitly, not assumed:
--
-- 1. LEADERSHIP HISTORY IS APPEND-ONLY, SEPARATE FROM CURRENT RESULTS.
--    side_comp_entries holds each player's CURRENT (correctable) result —
--    UNIQUE(side_comp_id, player_id), a correction is an UPDATE in place.
--    side_comp_lead_changes is a separate, append-only log written
--    exactly once whenever the authoritative leader actually changes.
--    Deriving history by replaying side_comp_entries alone would let a
--    later correction silently rewrite (or erase) a leadership change
--    that genuinely happened live — exactly what must not happen for
--    Event Story to stay auditable.
--
-- 2. POWERPLAY CONFIG LOCKS WHEN THE ROUND LEAVES 'upcoming'.
--    rounds.powerplay_hole_number is enforced immutable once
--    rounds.status is no longer 'upcoming' — via a trigger, not just an
--    app-level check, so this holds even against a direct API/SQL edit.
--    Same rule applies to side_comps rows for that round. This is what
--    makes doubling stableford_pts inside the existing compute_stableford
--    trigger safe: every score_entries row for a round was calculated
--    under one unchanging Powerplay configuration for that round's
--    entire scoring lifetime.
-- =============================================================================

-- ─── 1. rounds.powerplay_hole_number ────────────────────────────────────────
-- One column, on the table that's already correctly round-scoped and
-- already exists before begin_round() generates hole rows — so this can
-- be configured at round setup, before holes exist at all.

ALTER TABLE public.rounds
  ADD COLUMN powerplay_hole_number INTEGER CHECK (powerplay_hole_number BETWEEN 1 AND 18);

-- ─── 2. side_comps — widen and enforce round-scoping ────────────────────────
--
-- Defensive, not assumed: this table is confirmed unused by any
-- application code today (searched the entire codebase before writing
-- this migration — see delivery notes), so in practice it should be
-- empty in any real deployment. But ALTER COLUMN ... SET NOT NULL fails
-- outright if even one existing row has a NULL round_id, and the new
-- UNIQUE(round_id, comp_type) constraint below would fail if any two
-- existing rows collide on it — either would abort this entire migration
-- partway through. Rather than assume the table is empty and let a
-- surprise abort take down the whole deployment, both cases are handled
-- explicitly first.
--
-- Per the explicit "preserve data if there is any uncertainty"
-- instruction: any row that would violate the incoming constraints is
-- copied into a backup table BEFORE being removed from the live table,
-- not simply deleted. This sandbox has no way to query the actual
-- production database to confirm side_comps is genuinely empty there —
-- so rather than assert that and delete outright, anything found is
-- preserved, retrievable, and this migration logs how many rows (if
-- any) it moved, so a deploy log makes it obvious if this branch was
-- ever actually exercised.
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

  INSERT INTO public.side_comps_pre_sprint9_backup
    SELECT sc.* FROM public.side_comps sc
    WHERE EXISTS (
      SELECT 1 FROM public.side_comps sc2
      WHERE sc2.round_id = sc.round_id AND sc2.comp_type = sc.comp_type
        AND sc2.id <> sc.id
        -- Keep the most recently created row of the colliding pair; this
        -- table has no created_at column (migration 005 predates the
        -- convention), so id order is the only available tiebreaker —
        -- acceptable here since these rows are confirmed dormant/unused,
        -- not a judgment call about which real configuration to prefer.
        AND sc2.id > sc.id
    );
  GET DIAGNOSTICS v_dup_count = ROW_COUNT;
  DELETE FROM public.side_comps sc
    WHERE EXISTS (
      SELECT 1 FROM public.side_comps sc2
      WHERE sc2.round_id = sc.round_id AND sc2.comp_type = sc.comp_type
        AND sc2.id <> sc.id AND sc2.id > sc.id
    );

  IF v_null_round_count > 0 OR v_dup_count > 0 THEN
    RAISE NOTICE 'Sprint 9 migration: moved % row(s) with NULL round_id and % duplicate (round_id, comp_type) row(s) to side_comps_pre_sprint9_backup before applying new constraints. Review that table — this branch was not expected to fire against a table confirmed unused by application code.', v_null_round_count, v_dup_count;
  END IF;
END $$;

ALTER TABLE public.side_comps
  ALTER COLUMN round_id SET NOT NULL;

ALTER TABLE public.side_comps
  DROP CONSTRAINT IF EXISTS side_comps_comp_type_check;
ALTER TABLE public.side_comps
  ADD CONSTRAINT side_comps_comp_type_check
  CHECK (comp_type IN ('nearest_pin','longest_drive','pros_approach','best_on_day','custom'));

ALTER TABLE public.side_comps
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;

-- One configured competition of each type per round (toggling off/on
-- preserves the previously-selected hole rather than losing it).
ALTER TABLE public.side_comps
  ADD CONSTRAINT side_comps_round_type_unique UNIQUE (round_id, comp_type);

-- ─── 3. side_comp_entries — current, correctable result per player ──────────
-- NOT a replacement for side_comp_results (left untouched, see header).
-- UNIQUE(side_comp_id, player_id): a second submission or a correction is
-- an UPDATE of the same row, not a new one — this is what makes
-- resubmission-on-refresh idempotent by construction, and what makes a
-- correction (e.g. 8.0m fixed to 0.8m) recalculate the leader accurately
-- rather than leaving a stale/impossible value as the permanent winner.

CREATE TABLE public.side_comp_entries (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  side_comp_id  UUID        NOT NULL REFERENCES public.side_comps(id) ON DELETE CASCADE,
  player_id     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  qualified     BOOLEAN     NOT NULL, -- hit green (NTP/Pro's Approach) / hit fairway (Longest Drive)
  result_value  NUMERIC(6,2), -- metres from pin, or NULL when qualified=false (no valid result)
  moment_id     UUID        REFERENCES public.moments(id) ON DELETE SET NULL,
  entered_by    UUID        NOT NULL REFERENCES public.profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (side_comp_id, player_id),
  CHECK (qualified = true OR result_value IS NULL)
);

CREATE INDEX side_comp_entries_side_comp_id_idx ON public.side_comp_entries(side_comp_id);

CREATE TRIGGER side_comp_entries_updated_at
  BEFORE UPDATE ON public.side_comp_entries
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─── 4. side_comp_lead_changes — append-only leadership history ─────────────
-- Written exactly once per genuine leadership change (by the API route
-- that handles a result submission, inside the same transaction as the
-- side_comp_entries upsert — see delivery notes). Never updated, never
-- derived/replayed from side_comp_entries — this is the durable record
-- Event Story reads, immune to later corrections rewriting what actually
-- happened live. `sequence_number` gives a stable, gap-tolerant replay
-- order independent of clock precision.

CREATE TABLE public.side_comp_lead_changes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  side_comp_id    UUID        NOT NULL REFERENCES public.side_comps(id) ON DELETE CASCADE,
  player_id       UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  result_value    NUMERIC(6,2) NOT NULL,
  moment_id       UUID        REFERENCES public.moments(id) ON DELETE SET NULL,
  sequence_number INTEGER     NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (side_comp_id, sequence_number)
);

CREATE INDEX side_comp_lead_changes_side_comp_id_idx ON public.side_comp_lead_changes(side_comp_id, sequence_number);

-- ─── 5. Lock config once the round leaves 'upcoming' ────────────────────────
-- Enforced as a trigger (not just an app-level check) so this holds even
-- against a direct API/SQL edit, matching the "one authoritative
-- calculation path" reasoning: the Powerplay hole a score_entries row was
-- computed under must never be able to change after the fact.

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

CREATE TRIGGER side_comps_lock_after_start
  BEFORE INSERT OR UPDATE OR DELETE ON public.side_comps
  FOR EACH ROW EXECUTE FUNCTION public.enforce_round_config_lock();

CREATE OR REPLACE FUNCTION public.enforce_powerplay_lock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.powerplay_hole_number IS DISTINCT FROM NEW.powerplay_hole_number
     AND OLD.status IS DISTINCT FROM 'upcoming' THEN
    RAISE EXCEPTION 'Powerplay configuration is locked once the round has started.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER rounds_powerplay_lock
  BEFORE UPDATE OF powerplay_hole_number ON public.rounds
  FOR EACH ROW EXECUTE FUNCTION public.enforce_powerplay_lock();

-- ─── 6. Powerplay in the existing, authoritative Stableford trigger ─────────
-- The ONLY place stableford_pts is ever multiplied — every leaderboard,
-- cumulative-standings, and Final Results query already just reads the
-- stored value, so nothing downstream needs to know Powerplay exists.
-- calculate_stableford_points() itself (the pure formula) is intentionally
-- NOT changed — the multiplier is applied to its result here, in the
-- trigger that already joins holes/scorecards, keeping the pure formula
-- function reusable/testable on its own (mirrored by the equivalent
-- optional parameter added to the TS domain function, see
-- src/lib/scoring/stableford.ts).

CREATE OR REPLACE FUNCTION public.compute_stableford()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_par     INTEGER; v_si INTEGER; v_hc INTEGER;
  v_hole_no INTEGER; v_round_id UUID; v_pp_hole INTEGER;
  v_base    INTEGER;
BEGIN
  SELECT par, stroke_index, hole_number, round_id
    INTO v_par, v_si, v_hole_no, v_round_id
    FROM public.holes WHERE id = NEW.hole_id;
  SELECT playing_handicap INTO v_hc FROM public.scorecards WHERE id = NEW.scorecard_id;
  SELECT powerplay_hole_number INTO v_pp_hole FROM public.rounds WHERE id = v_round_id;

  v_base := CASE WHEN NEW.is_no_return THEN 0
    ELSE public.calculate_stableford_points(NEW.gross_score, v_par, v_si, v_hc) END;

  NEW.stableford_pts := CASE
    WHEN v_pp_hole IS NOT NULL AND v_hole_no = v_pp_hole THEN v_base * 2
    ELSE v_base
  END;
  RETURN NEW;
END;
$$;

-- ─── 7. RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE public.side_comp_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members: view entries" ON public.side_comp_entries FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.side_comps sc WHERE sc.id = side_comp_entries.side_comp_id AND public.is_trip_member(sc.trip_id)));
-- Players submit/correct their own entry only; organisers can correct anyone's
-- (the "correction path" the brief asks for) — mirrors the existing
-- score_entries insert-own / organiser-update-any split exactly.
CREATE POLICY "Players: insert own entry" ON public.side_comp_entries FOR INSERT
  WITH CHECK (entered_by = auth.uid() AND player_id = auth.uid());
CREATE POLICY "Players: update own entry" ON public.side_comp_entries FOR UPDATE
  USING (player_id = auth.uid());
CREATE POLICY "Organisers: manage entries" ON public.side_comp_entries FOR ALL
  USING (EXISTS (SELECT 1 FROM public.side_comps sc WHERE sc.id = side_comp_entries.side_comp_id AND public.is_trip_organiser(sc.trip_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.side_comps sc WHERE sc.id = side_comp_entries.side_comp_id AND public.is_trip_organiser(sc.trip_id)));

ALTER TABLE public.side_comp_lead_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members: view lead changes" ON public.side_comp_lead_changes FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.side_comps sc WHERE sc.id = side_comp_lead_changes.side_comp_id AND public.is_trip_member(sc.trip_id)));
-- Written server-side only, via the admin client from the result-submission
-- API route (matching how score_entries.stableford_pts itself is never
-- client-writable) — no INSERT policy for regular members at all.
CREATE POLICY "Organisers: manage lead changes" ON public.side_comp_lead_changes FOR ALL
  USING (EXISTS (SELECT 1 FROM public.side_comps sc WHERE sc.id = side_comp_lead_changes.side_comp_id AND public.is_trip_organiser(sc.trip_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.side_comps sc WHERE sc.id = side_comp_lead_changes.side_comp_id AND public.is_trip_organiser(sc.trip_id)));
