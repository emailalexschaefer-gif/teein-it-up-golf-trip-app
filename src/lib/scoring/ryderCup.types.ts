/**
 * Ryder Cup architecture preparation ONLY (point 11).
 *
 * Nothing in this file is wired into the running application. No database
 * tables have been created for this. These types exist so that when the
 * later Ryder Cup sprint starts, the domain vocabulary (teams, matches,
 * formats, outcomes, points) is already settled and consistent with the
 * scoring-domain types used everywhere else (TeamFormat, TeamHandicapResult),
 * instead of being invented from scratch under time pressure.
 *
 * See SCORING_ARCHITECTURE.md for the accompanying schema recommendation —
 * this file only covers the TypeScript side.
 */

import type { TeamFormat } from './types'

export type RyderCupTeamColour = 'red' | 'blue'

/** Ryder Cup matches reuse the same scoring formats already in this codebase. */
export type RyderCupMatchFormat = 'stroke' | 'stableford' | TeamFormat

export type RyderCupMatchOutcome = 'red_win' | 'blue_win' | 'halved'

/** Win = 1 point, halved = 0.5 each, loss = 0 — point 11's outcome rule. */
export const RYDER_CUP_OUTCOME_POINTS: Record<RyderCupMatchOutcome, { red: number; blue: number }> = {
  red_win: { red: 1, blue: 0 },
  blue_win: { red: 0, blue: 1 },
  halved:  { red: 0.5, blue: 0.5 },
}

export interface RyderCupEventTeam {
  teamId: string
  tripId: string
  colour: RyderCupTeamColour
  name: string
}

export interface RyderCupTeamMembership {
  teamId: string
  playerId: string
}

export interface RyderCupMatch {
  matchId: string
  eventId: string
  format: RyderCupMatchFormat
  /** Player ids involved — 2 for singles/pairs formats, more for a team match. */
  participantPlayerIds: string[]
  outcome: RyderCupMatchOutcome | null
}

/** What the eventual "Red Team 6.5 — Blue Team 5.5" display would read from. */
export interface RyderCupEventResult {
  eventId: string
  redPoints: number
  bluePoints: number
  matchesCompleted: number
  matchesTotal: number
}

export function sumRyderCupPoints(outcomes: RyderCupMatchOutcome[]): { redPoints: number; bluePoints: number } {
  return outcomes.reduce(
    (acc, outcome) => {
      const pts = RYDER_CUP_OUTCOME_POINTS[outcome]
      return { redPoints: acc.redPoints + pts.red, bluePoints: acc.bluePoints + pts.blue }
    },
    { redPoints: 0, bluePoints: 0 }
  )
}
