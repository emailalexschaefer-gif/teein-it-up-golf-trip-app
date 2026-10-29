// Package 4 / M2 -- one round's team state: what the SERVER holds (read through the signed-in user's own client, so RLS decides what is visible),
// and the PURE derivation of the screens' view data from it. Reading is separate from writing: all writes go through teamRpc.ts / the
// database functions. Nothing here grants authority; the UI uses `viewer` only to decide what to SHOW.

import type { ServerHoleScore, HoleInfo } from './scorerModel'
import { computeCompletion, grossTotal, buildLeaderboard, type TeamHoleScore, type LeaderboardTeam, type RankedRow, type UnrankedRow, type TeamCompletion } from './teamRound'
import { driveProgress, type DriveRow } from './drives'

export interface TeamStateRow {
  entry: { id: string; team_id: string; entry_name: string; nominated_scorer_id: string | null; scorer_confirmed_at: string | null; handicap_locked_at: string | null
    team_handicap: number | null; status: string; drive_requirement_waived_at: string | null; group_id: string | null }
}
/** What the database's own team_entry_completion() says. The app cross-checks it against the TypeScript rule and fails SAFE on any disagreement. */
export interface SqlCompletion {
  required_holes: number; missing_holes: number; unresolved_no_returns: number; no_score_holes: number
  open_flags: number; drive_shortfall_players: number; complete: boolean
}
export interface RawTeamState {
  round: { id: string; trip_id: string; status: string; setup_released?: boolean }
  holes: { id: string; hole_number: number; par: number }[]
  config: { format: 'ambrose_2' | 'ambrose_4'; team_size: 2 | 4; handicap_method: string; min_drives_per_player: number | null; setup_reopened_at?: string | null } | null
  entries: TeamStateRow['entry'][]
  /** The event's competition teams (so a retry after a half-finished save reuses the team instead of failing on a duplicate name). */
  teams: { id: string; name: string }[]
  members: { entry_id: string; player_id: string; position: number }[]
  scores: { entry_id: string; hole_id: string; gross_score: number | null; is_no_return: boolean; nr_treatment: string | null; revision: number; admin_overridden: boolean; drive_player_id: string | null }[]
  flags: { id: string; entry_id: string; hole_id: string; status: 'open' | 'resolved' | 'dismissed' }[]
  names: Record<string, string>
  /** Per-entry result of the database completion function (read through the user's client). Absent = not checked. */
  sqlCompletion?: Record<string, SqlCompletion>
}

export interface TeamStateDeps {
  getUser(): Promise<{ id: string } | null>
  load(roundId: string): Promise<RawTeamState | null>
  /** Server-side feature gate: when it says no, answer 404 as if the route did not exist. */
  enabled?: () => boolean
  /** Per-event gate (production only): given the round's event id. When it says no, answer 404. */
  tripAllowed?: (tripId: string) => boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function handleTeamStateRead(roundId: string | null, deps: TeamStateDeps): Promise<{ status: number; body: Record<string, unknown> }> {
  if (deps.enabled && !deps.enabled()) return { status: 404, body: { error: 'Not found' } }
  const user = await deps.getUser()
  if (!user) return { status: 401, body: { error: 'Not authenticated' } }
  if (!roundId || !UUID.test(roundId)) return { status: 400, body: { error: 'round_id must be a UUID' } }
  let state: RawTeamState | null
  try { state = await deps.load(roundId) } catch { return { status: 503, body: { error: 'Team state is unavailable right now.' } } }
  // RLS hides rounds the user is not a member of: that looks identical to "does not exist" on purpose.
  if (!state) return { status: 404, body: { error: 'Round not found' } }
  if (deps.tripAllowed && !deps.tripAllowed(state.round.trip_id)) return { status: 404, body: { error: 'Round not found' } }
  return { status: 200, body: { state, viewerId: user.id } }
}

export interface EntryView {
  entryId: string; name: string; scorerId: string | null; scorerConfirmed: boolean; handicapLocked: boolean; teamHandicap: number | null
  status: string; driveWaived: boolean
  memberIds: string[]
  holes: HoleInfo[]
  serverScores: ServerHoleScore[]
  openFlagHoleIds: string[]
  completion: TeamCompletion
  /** Fields on which the TypeScript rule and the database function disagree; null = database check not available. A disagreement makes the team NOT complete. */
  completionMismatch: string[] | null
  gross: number | null
  drives: DriveRow[] | null
}

export function compareCompletion(ts: TeamCompletion, sql: SqlCompletion | undefined): string[] | null {
  if (!sql) return null
  const diff: string[] = []
  if (ts.requiredHoles !== sql.required_holes) diff.push('required_holes')
  if (ts.missingHoles !== sql.missing_holes) diff.push('missing_holes')
  if (ts.unresolvedNoReturns !== sql.unresolved_no_returns) diff.push('unresolved_no_returns')
  if (ts.noScoreHoles !== sql.no_score_holes) diff.push('no_score_holes')
  if (ts.openFlags !== sql.open_flags) diff.push('open_flags')
  if (ts.driveShortfallPlayers.length !== sql.drive_shortfall_players) diff.push('drive_shortfall_players')
  if (ts.complete !== sql.complete) diff.push('complete')
  return diff
}

export function holesOf(s: RawTeamState): HoleInfo[] {
  return [...s.holes].sort((a, b) => a.hole_number - b.hole_number).map(h => ({ holeId: h.id, number: h.hole_number, par: h.par }))
}

/** One view per team entry. The hole count comes from the round's actual holes (9 or 18), never from a constant. */
export function deriveEntryViews(s: RawTeamState): EntryView[] {
  const holes = holesOf(s)
  const holeIds = holes.map(h => h.holeId)
  return s.entries.filter(e => e.status !== 'withdrawn').map(e => {
    const memberIds = s.members.filter(m => m.entry_id === e.id).sort((a, b) => a.position - b.position).map(m => m.player_id)
    const rows = s.scores.filter(r => r.entry_id === e.id)
    const serverScores: ServerHoleScore[] = rows.map(r => ({ holeId: r.hole_id, grossScore: r.gross_score, isNoReturn: r.is_no_return,
      nrTreatment: r.nr_treatment === 'no_score' ? 'no_score' : null, revision: r.revision, locked: r.admin_overridden, drivePlayerId: r.drive_player_id }))
    const teamScores: TeamHoleScore[] = rows.map(r => ({ holeId: r.hole_id, grossScore: r.gross_score, isNoReturn: r.is_no_return,
      nrTreatment: r.nr_treatment === 'no_score' ? 'no_score' : null, drivePlayerId: r.drive_player_id }))
    const flags = s.flags.filter(f => f.entry_id === e.id)
    const min = s.config?.min_drives_per_player ?? null
    const tsCompletion = computeCompletion({ requiredHoleIds: holeIds, scores: teamScores, flags: flags.map(f => ({ holeId: f.hole_id, status: f.status })),
      rosterPlayerIds: memberIds, drive: { minDrivesPerPlayer: min, waived: e.drive_requirement_waived_at !== null } })
    const completionMismatch = compareCompletion(tsCompletion, s.sqlCompletion?.[e.id])
    const completion: TeamCompletion = completionMismatch && completionMismatch.length > 0
      ? { ...tsCompletion, complete: false, blockers: [...tsCompletion.blockers, 'the completion check disagrees with the database — ask the organiser'] }
      : tsCompletion
    return { entryId: e.id, name: e.entry_name, scorerId: e.nominated_scorer_id, scorerConfirmed: e.scorer_confirmed_at !== null,
      handicapLocked: e.handicap_locked_at !== null, teamHandicap: e.team_handicap, status: e.status, driveWaived: e.drive_requirement_waived_at !== null,
      memberIds, holes, serverScores, openFlagHoleIds: flags.filter(f => f.status === 'open').map(f => f.hole_id), completion, completionMismatch,
      gross: grossTotal(holeIds, teamScores),
      drives: driveProgress(memberIds.map(id => ({ playerId: id, name: s.names[id] ?? 'Player' })), rows.map(r => r.drive_player_id), min) }
  })
}

/** Gross leaderboard from accepted server records only (queued, unsent scores never count). Net stays off. */
/** A leaderboard row carries the SAVED TEAM NAME and its players' names. A team is not a playing group: two teams can share one group. */
export type BoardRanked = RankedRow & { members: string[] }
export type BoardUnranked = UnrankedRow & { members: string[] }

export function deriveLeaderboard(views: EntryView[], names: Record<string, string> = {}): { ranked: BoardRanked[]; unranked: BoardUnranked[] } {
  const teams: LeaderboardTeam[] = views.map(v => ({ entryId: v.entryId, name: v.name, teamHandicap: v.teamHandicap, completion: v.completion, gross: v.gross }))
  const lb = buildLeaderboard(teams, 'gross', false)
  /* c8 ignore next */ if (!lb) throw new Error('gross leaderboard cannot be null')
  // For teams still playing, show how far they are and their running gross (never as a ranked result).
  const byId = new Map(views.map(v => [v.entryId, v]))
  const unranked = lb.unranked.map(u => {
    const v = byId.get(u.entryId)!
    const done = v.serverScores.filter(r => !r.isNoReturn && r.grossScore !== null)
    return { ...u, thru: done.length, runningGross: done.reduce((a, r) => a + (r.grossScore as number), 0), members: v.memberIds.map(id => names[id] ?? 'Player') }
  })
  return { ranked: lb.ranked.map(r => ({ ...r, members: byId.get(r.entryId)!.memberIds.map(id => names[id] ?? 'Player') })), unranked }
}

/** May this viewer enter scores for this team? (display only; the database function decides for real) */
export function viewerMayScore(v: EntryView, viewerId: string, roundStatus: string): { may: true } | { may: false; message: string } {
  if (roundStatus === 'completed' || roundStatus === 'cancelled') return { may: false, message: 'This round is closed. Ask the organiser to make a correction.' }
  // The database also refuses a scorer before the round is active; say so plainly instead of calling it "closed".
  if (roundStatus !== 'active') return { may: false, message: 'Scoring has not started yet. The organiser starts the round.' }
  if (v.status === 'withdrawn') return { may: false, message: 'This team has withdrawn from the round.' }
  if (!v.scorerConfirmed || !v.scorerId) return { may: false, message: 'The organiser has not confirmed a scorer for this team yet.' }
  if (v.scorerId !== viewerId) return { may: false, message: 'Only the team’s nominated scorer can enter scores. You can raise a query on any hole.' }
  return { may: true }
}
