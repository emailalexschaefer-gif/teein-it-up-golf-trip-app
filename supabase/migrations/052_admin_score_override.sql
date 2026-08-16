-- =============================================================================
-- 052_admin_score_override.sql
-- =============================================================================
-- Priority 6 — My HQ Admin Score Override. Treated as a high-integrity
-- feature per explicit instruction: every override is permanently
-- recorded (old value, new value, who, when, reason), never silently
-- overwritten with no trace.
--
-- Deliberately does NOT introduce a new scoring pathway. An override
-- updates the existing score_entries row for capture_role = 'self' —
-- the same column, the same UNIQUE(scorecard_id, hole_id, capture_role)
-- constraint from migration 022, the same compute_stableford() trigger
-- that already recalculates stableford_pts on UPDATE. "Recalculate
-- Stableford/leaderboards/results" is therefore not something this
-- migration needs to implement separately — it already happens, because
-- every leaderboard/results query reads score_entries directly rather
-- than a cached total, and the trigger already fires on UPDATE. This is
-- exactly "use the existing scoring architecture wherever possible."
--
-- score_override_audit is intentionally append-only (no UPDATE/DELETE
-- policy) — a correction to a correction is a NEW row, not an edited
-- one, so the full history is always reconstructable.
-- =============================================================================

ALTER TABLE public.score_entries
  ADD COLUMN IF NOT EXISTS admin_overridden BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.score_override_audit (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  score_entry_id   UUID        NOT NULL REFERENCES public.score_entries(id) ON DELETE CASCADE,
  scorecard_id     UUID        NOT NULL REFERENCES public.scorecards(id) ON DELETE CASCADE,
  hole_id          UUID        NOT NULL REFERENCES public.holes(id) ON DELETE CASCADE,
  old_gross_score  INTEGER,
  new_gross_score  INTEGER     NOT NULL,
  old_is_no_return BOOLEAN     NOT NULL DEFAULT false,
  new_is_no_return BOOLEAN     NOT NULL DEFAULT false,
  reason           TEXT        NOT NULL,
  overridden_by    UUID        NOT NULL REFERENCES public.profiles(id),
  overridden_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS score_override_audit_scorecard_idx ON public.score_override_audit(scorecard_id);
CREATE INDEX IF NOT EXISTS score_override_audit_entry_idx ON public.score_override_audit(score_entry_id);

ALTER TABLE public.score_override_audit ENABLE ROW LEVEL SECURITY;

-- Organisers of the trip that owns this scorecard's round can read the
-- audit trail — no player-facing read policy, since this is an
-- organiser/admin tool, matching "organiser/admin only" for the feature
-- as a whole. Writes only ever happen via the admin client from the
-- override API route, never directly from a client session, so no
-- INSERT policy is needed here (RLS default-denies, which is correct:
-- there is no legitimate direct-client insert path for this table).
CREATE POLICY "Organisers: view audit trail" ON public.score_override_audit
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.scorecards sc
      JOIN public.rounds r ON r.id = sc.round_id
      WHERE sc.id = score_override_audit.scorecard_id
        AND public.is_trip_organiser(r.trip_id)
    )
  );
