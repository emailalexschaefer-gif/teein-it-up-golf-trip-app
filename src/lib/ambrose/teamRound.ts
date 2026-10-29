// Package 4 / M2 -- team round state, ranking and leaderboard adapter. PURE. Mirrors the database function team_entry_completion
// (same inputs, same rule) so the UI and the database cannot disagree about what "complete" means.
//
// Principles (approved): a pick-up is No Return, never an invented score. An unresolved NR, a missing hole or an open dispute
// keeps a team OUT of official placings. Administratively closing the round is a different thing from being eligible to be ranked.
// An organiser may resolve an NR as "no score" (team stays Incomplete / Unranked) or enter an explicit reasoned score (then it is just a score).

import { netScore } from './handicap'

export interface TeamHoleScore {
  holeId: string
  grossScore: number | null
  isNoReturn: boolean
  /** null while an NR is unresolved; 'no_score' once the organiser has resolved it. */
  nrTreatment: 'no_score' | null
  drivePlayerId?: string | null
}
export interface TeamFlag { holeId: string; status: 'open' | 'resolved' | 'dismissed' }
export interface DriveRequirement { minDrivesPerPlayer: number | null; waived: boolean }

export type TeamStatus =
  | 'not_started' | 'in_progress'
  | 'needs_attention'        // round is finished/closed but something blocks an official result
  | 'complete'               // every hole validly scored, nothing outstanding -> eligible to be ranked
  | 'incomplete_unranked'    // administratively closed, but not eligible (missing hole / no-score NR / waived-nothing)

export interface TeamCompletion {
  requiredHoles: number
  scoredHoles: number          // holes with a real gross score
  missingHoles: number         // holes with no row at all
  unresolvedNoReturns: number  // NR with no organiser treatment
  noScoreHoles: number         // NR resolved as 'no score'
  openFlags: number
  driveShortfallPlayers: string[]
  complete: boolean
  blockers: string[]           // plain-language, in a stable order
}

export function computeCompletion(input: {
  requiredHoleIds: string[]
  scores: TeamHoleScore[]
  flags: TeamFlag[]
  rosterPlayerIds: string[]
  drive: DriveRequirement
}): TeamCompletion {
  const required = new Set(input.requiredHoleIds)
  const byHole = new Map<string, TeamHoleScore>()
  for (const s of input.scores) if (required.has(s.holeId)) byHole.set(s.holeId, s)
  const rows = [...byHole.values()]
  const scoredHoles = rows.filter(r => !r.isNoReturn && r.grossScore !== null).length
  const missingHoles = required.size - byHole.size
  const unresolvedNoReturns = rows.filter(r => r.isNoReturn && r.nrTreatment === null).length
  const noScoreHoles = rows.filter(r => r.isNoReturn && r.nrTreatment === 'no_score').length
  const openFlags = input.flags.filter(f => f.status === 'open').length
  let driveShortfallPlayers: string[] = []
  const min = input.drive.minDrivesPerPlayer
  if (min !== null && !input.drive.waived) {
    driveShortfallPlayers = input.rosterPlayerIds.filter(pid => rows.filter(r => r.drivePlayerId === pid).length < min)
  }
  const blockers: string[] = []
  if (missingHoles > 0) blockers.push(`${missingHoles} hole${missingHoles === 1 ? '' : 's'} not scored`)
  if (unresolvedNoReturns > 0) blockers.push(`${unresolvedNoReturns} No Return${unresolvedNoReturns === 1 ? '' : 's'} need an organiser decision`)
  if (noScoreHoles > 0) blockers.push(`${noScoreHoles} hole${noScoreHoles === 1 ? '' : 's'} recorded as No Score`)
  if (openFlags > 0) blockers.push(`${openFlags} open score query${openFlags === 1 ? '' : ' queries'}`)
  if (driveShortfallPlayers.length > 0) blockers.push(`minimum drives not met by ${driveShortfallPlayers.length} player${driveShortfallPlayers.length === 1 ? '' : 's'}`)
  // A No Score hole is a resolved NR but still means the team has no valid score for that hole: never eligible for placing.
  const complete = required.size > 0 && missingHoles === 0 && unresolvedNoReturns === 0 && noScoreHoles === 0 && openFlags === 0 && driveShortfallPlayers.length === 0
  return { requiredHoles: required.size, scoredHoles, missingHoles, unresolvedNoReturns, noScoreHoles, openFlags, driveShortfallPlayers, complete, blockers }
}

/** Gross total only when every required hole has a valid gross score; otherwise null (never a partial total shown as a result). */
export function grossTotal(requiredHoleIds: string[], scores: TeamHoleScore[]): number | null {
  const map = new Map(scores.map(s => [s.holeId, s]))
  let total = 0
  for (const id of requiredHoleIds) {
    const s = map.get(id)
    if (!s || s.isNoReturn || s.grossScore === null) return null
    total += s.grossScore
  }
  return requiredHoleIds.length > 0 ? total : null
}

/** Running total of the holes that DO have a score (for "thru N" display only; never used for ranking). */
export function runningGross(scores: TeamHoleScore[]): { total: number; holes: number } {
  const valid = scores.filter(s => !s.isNoReturn && s.grossScore !== null)
  return { total: valid.reduce((a, s) => a + (s.grossScore as number), 0), holes: valid.length }
}

export function teamStatus(c: TeamCompletion, roundClosedAdministratively: boolean): TeamStatus {
  if (c.complete) return 'complete'
  const touched = c.scoredHoles + c.unresolvedNoReturns + c.noScoreHoles > 0
  if (!roundClosedAdministratively) return touched ? 'in_progress' : 'not_started'
  // Closed: the organiser can finish the administrative workflow without inventing a number.
  const onlyNeedsDecision = c.unresolvedNoReturns > 0 || c.openFlags > 0 || c.driveShortfallPlayers.length > 0
  return onlyNeedsDecision ? 'needs_attention' : 'incomplete_unranked'
}

export interface LeaderboardTeam {
  entryId: string
  name: string
  teamHandicap: number | null
  completion: TeamCompletion
  gross: number | null
}
export type RankBasis = 'gross' | 'net'
export interface RankedRow { entryId: string; name: string; rank: number; tied: boolean; gross: number; net: number | null; teamHandicap: number | null }
export interface UnrankedRow { entryId: string; name: string; reason: string; thru: number; runningGross: number | null }

/**
 * Ranking: eligible teams only (completion.complete). Ties share a rank ("T2") -- no countback is invented here; a countback
 * rule is an approved-later decision. Net ranking is refused (returns null) unless `netEnabled`, which stays false until the
 * handicap inputs and calculation are approved.
 */
export function buildLeaderboard(teams: LeaderboardTeam[], basis: RankBasis, netEnabled: boolean): { ranked: RankedRow[]; unranked: UnrankedRow[] } | null {
  if (basis === 'net' && !netEnabled) return null
  const eligible: (LeaderboardTeam & { gross: number; net: number | null })[] = []
  const unranked: UnrankedRow[] = []
  for (const t of teams) {
    const net = t.gross !== null && t.teamHandicap !== null ? netScore(t.gross, t.teamHandicap) : null
    const ok = t.completion.complete && t.gross !== null && (basis === 'gross' || net !== null)
    if (ok) eligible.push({ ...t, gross: t.gross as number, net })
    else {
      const reason = !t.completion.complete ? (t.completion.blockers.join('; ') || 'Not complete')
        : basis === 'net' ? 'No team handicap set' : 'No valid gross total'
      unranked.push({ entryId: t.entryId, name: t.name, reason, thru: t.completion.scoredHoles, runningGross: null })
    }
  }
  const key = (t: { gross: number; net: number | null }) => (basis === 'net' ? (t.net as number) : t.gross)
  eligible.sort((a, b) => key(a) - key(b) || a.name.localeCompare(b.name))
  const ranked: RankedRow[] = []
  eligible.forEach((t, i) => {
    const rank = i > 0 && key(eligible[i - 1]) === key(t) ? ranked[i - 1].rank : i + 1
    ranked.push({ entryId: t.entryId, name: t.name, rank, tied: false, gross: t.gross, net: t.net, teamHandicap: t.teamHandicap })
  })
  for (const r of ranked) r.tied = ranked.filter(x => x.rank === r.rank).length > 1
  unranked.sort((a, b) => a.name.localeCompare(b.name))
  return { ranked, unranked }
}
