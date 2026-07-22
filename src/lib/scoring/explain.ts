import type { TeamHandicapResult } from './types'
import type { CalculateDailyHandicapInput } from './dailyHandicap'

/**
 * Human-readable explanation strings for handicap calculations (point 15).
 * Not wired into any screen yet — the current scoring UI stays uncluttered
 * per the brief. These exist so that whenever an info-icon / calculation
 * details modal is built (Sprint 5C+), it has a ready-made, tested string
 * to show rather than ad-hoc template literals scattered through the UI.
 */

export function explainDailyHandicap(
  input: CalculateDailyHandicapInput,
  finalHandicap: number
): string {
  const raw = (input.gaHandicap * input.slopeRating) / 113
  return `Daily Handicap\n${input.gaHandicap} × ${input.slopeRating} ÷ 113 = ${raw.toFixed(2)} → ${finalHandicap}`
}

const FORMAT_LABEL: Record<TeamHandicapResult['format'], string> = {
  two_player_ambrose: 'Two-Player Ambrose Handicap',
  four_player_ambrose: 'Four-Player Ambrose Handicap',
  alternate_shot: 'Alternate-Shot Handicap',
}

export function explainTeamHandicap(result: TeamHandicapResult): string {
  const sumExpr = result.playerHandicaps.join(' + ')
  const pct = `${(result.allowance * 100).toFixed(1).replace(/\.0$/, '')}%`
  return `${FORMAT_LABEL[result.format]}\n(${sumExpr}) × ${pct} = ${result.finalHandicap}`
}
