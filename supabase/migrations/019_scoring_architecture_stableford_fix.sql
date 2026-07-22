-- =============================================================================
-- 019: Scoring Architecture Update — Fix DB-side Stableford Function
-- =============================================================================
-- The score_entries.stableford_pts column is computed by a Postgres trigger
-- (compute_stableford → calculate_stableford_points, migration 004), which is
-- necessarily a SEPARATE implementation from src/lib/scoring/stableford.ts —
-- the database has to be able to compute this independently of the Node
-- process for integrity reasons. That means the two implementations must be
-- kept in sync by hand; this migration brings the DB side back in line with
-- the TS domain layer's two real fixes:
--
--   1. No artificial cap. The old function used
--      `LEAST(5, GREATEST(0, 2 - (v_net - p_par)))`, silently discarding any
--      result better than a nett albatross. The corrected formula has no
--      upper bound, matching src/lib/scoring/stableford.ts.
--
--   2. Correct handicap-stroke allocation for negative (plus) handicaps.
--      Postgres integer division truncates toward zero and `%` keeps the
--      sign of the dividend — identical to the bug already fixed in
--      src/lib/scoring/strokeAllocation.ts on the TS side. This uses the
--      same true-floor / true-modulo approach there.
--
-- This is a function replacement only — no table structure changes, no data
-- migration. Existing `score_entries.stableford_pts` values are NOT
-- recomputed retroactively; only future INSERT/UPDATE recalculate. If a
-- retroactive recompute is wanted, that's a separate, explicit decision
-- (see "Known limitations" in TESTING.md) — this migration does not do it
-- automatically, since silently rewriting historical scores without the
-- organiser's knowledge would be its own kind of bug.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.calculate_stableford_points(
  p_gross       INTEGER,
  p_par         INTEGER,
  p_stroke_idx  INTEGER,
  p_handicap    INTEGER
) RETURNS INTEGER LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_full_strokes INTEGER;
  v_remainder    INTEGER;
  v_strokes      INTEGER;
  v_net          INTEGER;
BEGIN
  -- True floor division (not Postgres's truncate-toward-zero integer /).
  v_full_strokes := floor(p_handicap::numeric / 18);
  -- True (always non-negative) modulo, matching getHandicapStrokesForHole().
  v_remainder     := p_handicap - (v_full_strokes * 18);

  v_strokes := v_full_strokes + CASE WHEN p_stroke_idx <= v_remainder THEN 1 ELSE 0 END;
  v_net     := p_gross - v_strokes;

  -- No upper cap — a result better than nett albatross is a legitimate,
  -- if rare, outcome and must not be silently discarded.
  RETURN GREATEST(0, 2 + p_par - v_net);
END;
$$;
