import { ScoringDomainError } from './errors'
import type { PlayingHandicap } from './types'

export interface HoleStrokeAllocationInput {
  /** The player's (or team's) playing handicap for this round. */
  playingHandicap: PlayingHandicap
  /** The hole's stroke index (difficulty ranking, 1 = hardest). */
  strokeIndex: number
  /** Holes in the round — 18 by default; 9-hole rounds use 9. */
  holesInRound?: number
}

/**
 * How many handicap strokes a player receives on a single hole, given
 * their playing handicap and that hole's stroke index.
 *
 * This is the ONE place this calculation lives. Previously it was
 * duplicated inline in both `stableford.ts` (for the Stableford formula)
 * and `ScoreSessionShell.tsx` (for the "SHOTS" display) — those now both
 * call this function instead of re-deriving the same arithmetic.
 *
 * General formula (supports handicaps above 36, and negative/plus
 * handicaps, without a separate rule per range — point 3):
 *
 *   fullStrokes = floor(playingHandicap / holesInRound)
 *   remainder   = true-mod(playingHandicap, holesInRound)   — always in [0, holesInRound)
 *   extraStroke = 1 if strokeIndex <= remainder, else 0
 *   strokes     = fullStrokes + extraStroke
 *
 * "True mod" matters here: JavaScript's `%` operator can return a negative
 * remainder for a negative dividend (e.g. `-2 % 18 === -2`, not `16`),
 * which would silently misallocate strokes for plus-handicap players.
 * `((h % n) + n) % n` normalises that to the mathematical convention,
 * where the remainder is always non-negative.
 *
 * Worked examples:
 *   hcp 10 → 1 stroke on SI 1–10, 0 on SI 11–18
 *   hcp 24 → 2 strokes on SI 1–6, 1 stroke on SI 7–18
 *   hcp 36 → 2 strokes on every hole
 *   hcp 40 → 3 strokes on SI 1–4, 2 strokes on SI 5–18
 *   hcp -2 (a "plus 2" handicap) → 0 strokes on SI 1–16, -1 (gives a
 *     stroke back) on the two easiest-rated holes, SI 17–18
 */
export function getHandicapStrokesForHole({
  playingHandicap,
  strokeIndex,
  holesInRound = 18,
}: HoleStrokeAllocationInput): number {
  if (typeof playingHandicap !== 'number' || Number.isNaN(playingHandicap)) {
    throw new ScoringDomainError('MISSING_HANDICAP', 'playingHandicap must be a number')
  }
  if (!Number.isInteger(strokeIndex) || strokeIndex < 1 || strokeIndex > holesInRound) {
    throw new ScoringDomainError(
      'INVALID_STROKE_INDEX',
      `strokeIndex must be a whole number between 1 and ${holesInRound}, received ${strokeIndex}`
    )
  }

  const fullStrokes = Math.floor(playingHandicap / holesInRound)
  const remainder = ((playingHandicap % holesInRound) + holesInRound) % holesInRound
  const extraStroke = strokeIndex <= remainder ? 1 : 0

  return fullStrokes + extraStroke
}
