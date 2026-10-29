import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summariseTeamRound } from './roundSummary'
import type { RawTeamState } from './teamState'

const H = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`
const E = (n: number) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`
const holes = [1, 2, 3].map(n => ({ id: H(n), hole_number: n, par: 4 }))
const state = (status: string, scores: Record<number, number[]>, extra: Partial<RawTeamState> = {}): RawTeamState => ({
  round: { id: 'r', trip_id: 't', status }, holes, config: { format: 'ambrose_4', team_size: 4, handicap_method: 'gross_only', min_drives_per_player: null },
  entries: [1, 2].map(n => ({ id: E(n), team_id: E(n + 10), entry_name: `Team ${n}`, nominated_scorer_id: null, scorer_confirmed_at: null, handicap_locked_at: null, team_handicap: null, status: 'entered', drive_requirement_waived_at: null, group_id: null })),
  teams: [], members: [], flags: [], names: {},
  scores: Object.entries(scores).flatMap(([e, gs]) => gs.map((g, i) => ({ entry_id: E(Number(e)), hole_id: H(i + 1), gross_score: g, is_no_return: false, nr_treatment: null, revision: 1, admin_overridden: false, drive_player_id: null }))),
  ...extra }) as RawTeamState

test('team completion replaces individual completion: counts teams, not players', () => {
  const s = summariseTeamRound(state('active', { 1: [4, 4, 4], 2: [4, 4] }))
  assert.equal(s.teams, 2); assert.equal(s.completeTeams, 1); assert.equal(s.completionPct, 50); assert.equal(s.holesToScore, 1)
  assert.deepEqual(s.incompleteTeams, ['Team 2']); assert.equal(s.readyToClose, false)
})
test('ready to close only when every team is complete AND the round is active', () => {
  assert.equal(summariseTeamRound(state('active', { 1: [4, 4, 4], 2: [4, 4, 4] })).readyToClose, true)
  assert.equal(summariseTeamRound(state('completed', { 1: [4, 4, 4], 2: [4, 4, 4] })).readyToClose, false)
  assert.equal(summariseTeamRound(state('upcoming', { 1: [4, 4, 4], 2: [4, 4, 4] })).readyToClose, false)
})
test('an open query needs the organiser and blocks closing', () => {
  const s = summariseTeamRound(state('active', { 1: [4, 4, 4], 2: [4, 4, 4] }, { flags: [{ id: 'f', entry_id: E(2), hole_id: H(1), status: 'open' }] }))
  assert.equal(s.needsOrganiser, 1); assert.equal(s.readyToClose, false); assert.equal(s.completeTeams, 1)
})
test('a database disagreement fails safe (not complete)', () => {
  const sql = { required_holes: 3, missing_holes: 0, unresolved_no_returns: 0, no_score_holes: 0, open_flags: 0, drive_shortfall_players: 0, complete: false }
  const s = summariseTeamRound(state('active', { 1: [4, 4, 4], 2: [4, 4, 4] }, { sqlCompletion: { [E(1)]: sql, [E(2)]: { ...sql, complete: true } } }))
  assert.equal(s.completeTeams, 1); assert.equal(s.readyToClose, false)
})
test('no teams: zero percent, never ready', () => {
  const s = summariseTeamRound(state('active', {}, { entries: [] }))
  assert.equal(s.teams, 0); assert.equal(s.completionPct, 0); assert.equal(s.readyToClose, false)
})
