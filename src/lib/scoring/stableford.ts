import { ScoringDomainError } from './errors'
import { getHandicapStrokesForHole } from './strokeAllocation'
import type { PlayingHandicap } from './types'

export interface StablefordInput {
  grossScore: number
  par: number
  strokeIndex: number
  playingHandicap: PlayingHandicap
  holesInRound?: number
}

/**
 * Stableford points for a single hole, calculated from the NETT score, not
 * gross (point 2 of the format update). This was already correct before
 * this update — the one real bug was an artificial `Math.min(5, ...)` cap,
 * which silently discarded any result better than a nett albatross.
 *
 * Calculation order (as specified):
 *   1. Gross strokes entered            → grossScore
 *   2. Handicap strokes received         → getHandicapStrokesForHole()
 *   3. Nett score                        → grossScore - handicapStrokesReceived
 *   4. Nett result relative to par       → nettScore - par
 *   5. Stableford points                 → max(0, 2 + par - nettScore)
 *
 * There is deliberately no upper cap: nett albatross (5), and anything
 * better, resolve from the same formula rather than a hard-coded table.
 *
 * The Postgres trigger `calculate_stableford_points()` (migration 019)
 * implements the identical formula server-side, for the DB to be the
 * source of truth independent of the client. If you change this function,
 * change that migration too.
 */
export function calculateStableford(input: StablefordInput): number {
  const { grossScore, par, strokeIndex, playingHandicap, holesInRound = 18 } = input

  if (typeof grossScore !== 'number' || Number.isNaN(grossScore) || grossScore < 1) {
    throw new ScoringDomainError('NON_NUMERIC_VALUE', 'grossScore must be a positive number')
  }
  if (typeof par !== 'number' || Number.isNaN(par) || par < 3) {
    throw new ScoringDomainError('NON_NUMERIC_VALUE', 'par must be a number, 3 or greater')
  }

  const handicapStrokesReceived = getHandicapStrokesForHole({ playingHandicap, strokeIndex, holesInRound })
  const nettScore = grossScore - handicapStrokesReceived

  return Math.max(0, 2 + par - nettScore)
}
