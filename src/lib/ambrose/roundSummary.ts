// Package 4 / Sprint 2 -- the team-based completion summary My HQ shows for an Ambrose round instead of the individual-scorecard numbers.
// PURE. Built from deriveEntryViews, so it inherits the fail-safe database cross-check: a team whose app rule and database function disagree is NOT complete.
import { deriveEntryViews, type RawTeamState } from './teamState'

export interface TeamRoundSummary {
  teams: number; completeTeams: number; completionPct: number
  /** Things only the organiser can clear: unresolved No Returns + open score queries + drive shortfalls (counted once per item). */
  needsOrganiser: number
  /** Holes still without any score across all teams. */
  holesToScore: number
  /** Every live team is complete and the round is active: the one Close Round action may be used. */
  readyToClose: boolean
  incompleteTeams: string[]
}

export function summariseTeamRound(state: RawTeamState): TeamRoundSummary {
  const views = deriveEntryViews(state)
  const complete = views.filter(v => v.completion.complete)
  let needs = 0, holes = 0
  for (const v of views) { needs += v.completion.unresolvedNoReturns + v.completion.openFlags + v.completion.driveShortfallPlayers.length; holes += v.completion.missingHoles }
  const teams = views.length
  return {
    teams, completeTeams: complete.length, completionPct: teams === 0 ? 0 : Math.floor((complete.length / teams) * 100),
    needsOrganiser: needs, holesToScore: holes,
    readyToClose: state.round.status === 'active' && teams > 0 && complete.length === teams,
    incompleteTeams: views.filter(v => !v.completion.complete).map(v => v.name),
  }
}
