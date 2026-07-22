import { ScoringDomainError } from './errors'
import { roundHandicap } from './rounding'
import type { GaHandicap, DailyHandicap, RoundingMode } from './types'

export interface CalculateDailyHandicapInput {
  gaHandicap: GaHandicap
  slopeRating: number
  roundingMode?: RoundingMode
}

/**
 * Darren's supplied MVP formula (point 4):
 *
 *   Daily Handicap = GA Handicap × Slope Rating ÷ 113
 *
 * Example: 8.8 × 138 ÷ 113 = 10.747... → 11
 *
 * NOT currently wired into the live round-start flow. `resolvePlayingHandicap`
 * (src/lib/scoring/defaultHoles.ts) is what Sprint 5A actually uses today,
 * and it does not apply a slope adjustment — there is no `slope_rating`
 * column anywhere in the current schema (trips, rounds, or a courses
 * table) for this function to read from. This function exists, is fully
 * tested, and is ready to be wired in the moment slope rating has
 * somewhere to live — see SCORING_ARCHITECTURE.md for the schema decision
 * this is waiting on.
 *
 * Future-proofing (point 4): this only takes GA handicap and slope rating
 * today. The full WHS Course Handicap formula also adds
 * (Course Rating − Par) and a Playing Conditions Calculation (PCC)
 * adjustment. Those aren't implemented — deliberately, per this sprint's
 * scope — but adding them later is a matter of extending this input type
 * and the one line of arithmetic below, not rewriting anything that calls
 * it, because every caller already goes through this named function
 * rather than inlining the formula.
 */
export function calculateDailyHandicap({
  gaHandicap,
  slopeRating,
  roundingMode = 'nearest',
}: CalculateDailyHandicapInput): DailyHandicap {
  if (typeof gaHandicap !== 'number' || Number.isNaN(gaHandicap)) {
    throw new ScoringDomainError('MISSING_HANDICAP', 'gaHandicap must be a number')
  }
  if (slopeRating === null || slopeRating === undefined) {
    throw new ScoringDomainError('MISSING_SLOPE_RATING', 'slopeRating is required')
  }
  if (typeof slopeRating !== 'number' || Number.isNaN(slopeRating)) {
    throw new ScoringDomainError('INVALID_SLOPE_RATING', 'slopeRating must be a number')
  }
  if (slopeRating <= 0) {
    throw new ScoringDomainError('INVALID_SLOPE_RATING', 'slopeRating must be greater than 0')
  }
  if (roundingMode !== 'nearest') {
    throw new ScoringDomainError('UNSUPPORTED_ROUNDING_MODE', `Unsupported roundingMode: ${roundingMode}`)
  }

  const unrounded = (gaHandicap * slopeRating) / 113
  return roundHandicap(unrounded)
}
