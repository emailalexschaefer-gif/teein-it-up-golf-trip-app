import { ScoringDomainError } from './errors'
import { getHandicapStrokesForHole } from './strokeAllocation'
import type { PlayingHandicap } from './types'

export interface StablefordInput {
  grossScore: number
  par: number
  strokeIndex: number
  playingHandicap: PlayingHandicap
  holesInRound?: number
  // Sprint 9 — Powerplay. Mirrors the identical change made to the
  // Postgres compute_stableford() trigger (migration 037): the trigger is
  // the actual authoritative, persisted calculation (every leaderboard/
  // final-results query reads score_entries.stableford_pts directly, not
  // a recomputed value) — this parameter exists so the TS domain layer
  // stays in sync for any client-side preview ("3 × 2 = 6 pts") and so
  // this exact doubling behaviour is covered by the same test suite.
  // Deliberately just a boolean ×2, not a configurable multiplier — V1
  // scope, one fixed rule, no multiplier editor.
  isPowerplayHole?: boolean
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
 *   6. Powerplay (Sprint 9)              → ×2 if isPowerplayHole, applied
 *                                           to the result of step 5, never
 *                                           folded into the base formula
 *
 * There is deliberately no upper cap: nett albatross (5), and anything
 * better, resolve from the same formula rather than a hard-coded table.
 *
 * The Postgres trigger `calculate_stableford_points()` (migration 019) plus
 * `compute_stableford()`'s Powerplay multiplier (migration 037) implements
 * the identical formula server-side, for the DB to be the source of truth
 * independent of the client. If you change this function, change those too.
 */
export function calculateStableford(input: StablefordInput): number {
  const { grossScore, par, strokeIndex, playingHandicap, holesInRound = 18, isPowerplayHole = false } = input

  if (typeof grossScore !== 'number' || Number.isNaN(grossScore) || grossScore < 1) {
    throw new ScoringDomainError('NON_NUMERIC_VALUE', 'grossScore must be a positive number')
  }
  if (typeof par !== 'number' || Number.isNaN(par) || par < 3) {
    throw new ScoringDomainError('NON_NUMERIC_VALUE', 'par must be a number, 3 or greater')
  }

  const handicapStrokesReceived = getHandicapStrokesForHole({ playingHandicap, strokeIndex, holesInRound })
  const nettScore = grossScore - handicapStrokesReceived
  const basePoints = Math.max(0, 2 + par - nettScore)

  return isPowerplayHole ? basePoints * 2 : basePoints
}
