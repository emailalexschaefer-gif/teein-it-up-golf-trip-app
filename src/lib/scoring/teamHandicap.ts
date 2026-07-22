import { ScoringDomainError } from './errors'
import { roundHandicap } from './rounding'
import type { TeamFormat, TeamHandicapResult, RoundingMode } from './types'

export interface HandicapAllowanceConfig {
  twoPlayerAmbrose: number
  fourPlayerAmbrose: number
  alternateShot: number
}

/**
 * Darren's default allowances (points 5–8). Centralised here rather than
 * hard-coded at each call site, so an organiser/club override is a config
 * override, not a code change.
 */
export const DEFAULT_HANDICAP_ALLOWANCES: HandicapAllowanceConfig = {
  twoPlayerAmbrose: 0.25,   // (A + B) ÷ 4
  fourPlayerAmbrose: 0.125, // (P1+P2+P3+P4) ÷ 8
  alternateShot: 0.5,       // (A + B) ÷ 2
}

const EXPECTED_PLAYER_COUNT: Record<TeamFormat, number> = {
  two_player_ambrose: 2,
  four_player_ambrose: 4,
  alternate_shot: 2,
}

const ALLOWANCE_KEY: Record<TeamFormat, keyof HandicapAllowanceConfig> = {
  two_player_ambrose: 'twoPlayerAmbrose',
  four_player_ambrose: 'fourPlayerAmbrose',
  alternate_shot: 'alternateShot',
}

export interface CalculateTeamHandicapInput {
  format: TeamFormat
  /** Each team member's individual (daily/playing) handicap, in any order. */
  playerHandicaps: number[]
  /**
   * Optional matching player ids, used only to reject duplicate entries
   * (the same player counted twice on one team). Not persisted anywhere
   * by this function — purely a validation aid for the caller.
   */
  playerIds?: string[]
  /** Override one or more default allowances (point 8) — e.g. a club using a stricter Ambrose allowance. */
  allowances?: Partial<HandicapAllowanceConfig>
  roundingMode?: RoundingMode
}

/**
 * Reusable team-handicap calculation for two-player Ambrose, four-player
 * Ambrose, and alternate shot (points 5–7). Returns a full result object,
 * not a bare number (point 10), so the calculation stays auditable —
 * useful today for troubleshooting, and later for an organiser-facing
 * "how was this calculated" explanation (point 15 / explain.ts).
 */
export function calculateTeamHandicap({
  format,
  playerHandicaps,
  playerIds,
  allowances,
  roundingMode = 'nearest',
}: CalculateTeamHandicapInput): TeamHandicapResult {
  if (!Array.isArray(playerHandicaps) || playerHandicaps.length === 0) {
    throw new ScoringDomainError('EMPTY_TEAM', 'playerHandicaps must be a non-empty array')
  }

  const expectedCount = EXPECTED_PLAYER_COUNT[format]
  if (!expectedCount) {
    throw new ScoringDomainError('WRONG_PLAYER_COUNT', `Unknown team format: ${format}`)
  }
  if (playerHandicaps.length !== expectedCount) {
    throw new ScoringDomainError(
      'WRONG_PLAYER_COUNT',
      `${format} requires exactly ${expectedCount} players, received ${playerHandicaps.length}`
    )
  }

  for (const h of playerHandicaps) {
    if (typeof h !== 'number' || Number.isNaN(h)) {
      throw new ScoringDomainError('MISSING_HANDICAP', 'Every player handicap must be a number')
    }
  }

  if (playerIds) {
    if (playerIds.length !== playerHandicaps.length) {
      throw new ScoringDomainError('WRONG_PLAYER_COUNT', 'playerIds must match playerHandicaps length')
    }
    const unique = new Set(playerIds)
    if (unique.size !== playerIds.length) {
      throw new ScoringDomainError('DUPLICATE_PLAYER_ID', 'The same player cannot appear twice on one team')
    }
  }

  if (roundingMode !== 'nearest') {
    throw new ScoringDomainError('UNSUPPORTED_ROUNDING_MODE', `Unsupported roundingMode: ${roundingMode}`)
  }

  const resolvedAllowances = { ...DEFAULT_HANDICAP_ALLOWANCES, ...allowances }
  const allowance = resolvedAllowances[ALLOWANCE_KEY[format]]

  const combinedHandicap = playerHandicaps.reduce((sum, h) => sum + h, 0)
  const unroundedHandicap = combinedHandicap * allowance
  const finalHandicap = roundHandicap(unroundedHandicap)

  return {
    format,
    playerHandicaps: [...playerHandicaps],
    combinedHandicap,
    allowance,
    unroundedHandicap,
    finalHandicap,
    roundingMode,
  }
}
