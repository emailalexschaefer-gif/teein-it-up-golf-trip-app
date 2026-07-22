/**
 * Typed errors for the scoring domain layer.
 *
 * These are thrown by pure scoring functions (stableford, stroke allocation,
 * daily handicap, team handicap) on invalid input, instead of silently
 * returning zero or NaN. API routes that call into this layer should catch
 * ScoringDomainError and translate it into a 400/422 response with `err.code`
 * and `err.message` — the same pattern already used for zod validation
 * failures elsewhere in the API (see src/app/api/scores/route.ts).
 */

export type ScoringErrorCode =
  | 'MISSING_SLOPE_RATING'
  | 'INVALID_SLOPE_RATING'
  | 'MISSING_HANDICAP'
  | 'INVALID_HANDICAP'
  | 'NON_NUMERIC_VALUE'
  | 'WRONG_PLAYER_COUNT'
  | 'EMPTY_TEAM'
  | 'DUPLICATE_PLAYER_ID'
  | 'UNSUPPORTED_ROUNDING_MODE'
  | 'INVALID_STROKE_INDEX'

export class ScoringDomainError extends Error {
  readonly code: ScoringErrorCode

  constructor(code: ScoringErrorCode, message: string) {
    super(message)
    this.name = 'ScoringDomainError'
    this.code = code
  }
}
