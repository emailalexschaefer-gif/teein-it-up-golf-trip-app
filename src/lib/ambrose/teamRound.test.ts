import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeCompletion, grossTotal, runningGross, teamStatus, buildLeaderboard, type TeamHoleScore, type LeaderboardTeam } from './teamRound'
import { driveProgress, driveRiskMessage } from './drives'

const holes = Array.from({ length: 18 }, (_, i) => `h${i + 1}`)
const sc = (holeId: string, g: number | null, nr = false, t: 'no_score' | null = null, drive: string | null = null): TeamHoleScore => ({ holeId, grossScore: g, isNoReturn: nr, nrTreatment: t, drivePlayerId: drive })
const full = (g = 4) => holes.map(h => sc(h, g))
const comp = (scores: TeamHoleScore[], extra: Partial<Parameters<typeof computeCompletion>[0]> = {}) =>
  computeCompletion({ requiredHoleIds: holes, scores, flags: [], rosterPlayerIds: ['a', 'b'], drive: { minDrivesPerPlayer: null, waived: false }, ...extra })

test('complete only when every hole is validly scored with nothing outstanding', () => {
  assert.equal(comp(full()).complete, true)
  assert.equal(comp(full().slice(1)).complete, false)
  assert.deepEqual(comp(full().slice(1)).blockers, ['1 hole not scored'])
})
test('unresolved No Return blocks completion and is never turned into a score', () => {
  const s = full(); s[3] = sc('h4', null, true)
  const c = comp(s)
  assert.equal(c.complete, false); assert.equal(c.unresolvedNoReturns, 1)
  assert.equal(grossTotal(holes, s), null)
  assert.deepEqual(runningGross(s), { total: 17 * 4, holes: 17 })
})
test('organiser "no score" resolution keeps the card but the team stays out of official results', () => {
  const s = full(); s[3] = sc('h4', null, true, 'no_score')
  const c = comp(s)
  assert.equal(c.complete, false); assert.equal(c.noScoreHoles, 1); assert.equal(c.unresolvedNoReturns, 0)
  assert.equal(teamStatus(c, true), 'incomplete_unranked')
  assert.equal(grossTotal(holes, s), null)
})
test('an explicit reasoned score replaces the NR and the team is complete again', () => {
  const s = full(); s[3] = sc('h4', 7)
  assert.equal(comp(s).complete, true); assert.equal(grossTotal(holes, s), 17 * 4 + 7)
})
test('open flags block until resolved; resolved/dismissed do not', () => {
  assert.equal(comp(full(), { flags: [{ holeId: 'h2', status: 'open' }] }).complete, false)
  assert.equal(comp(full(), { flags: [{ holeId: 'h2', status: 'resolved' }, { holeId: 'h3', status: 'dismissed' }] }).complete, true)
})
test('drive requirement: shortfall blocks, waiver releases, off by default', () => {
  const s = full().map((x, i) => ({ ...x, drivePlayerId: i < 9 ? 'a' : 'b' }))
  assert.equal(comp(s, { drive: { minDrivesPerPlayer: 4, waived: false } }).complete, true)
  const lopsided = full().map(x => ({ ...x, drivePlayerId: 'a' }))
  const c = comp(lopsided, { drive: { minDrivesPerPlayer: 4, waived: false } })
  assert.deepEqual(c.driveShortfallPlayers, ['b']); assert.equal(c.complete, false)
  assert.equal(comp(lopsided, { drive: { minDrivesPerPlayer: 4, waived: true } }).complete, true)
  assert.equal(comp(lopsided).complete, true)
})
test('administrative closure is separate from eligibility', () => {
  const partial = full().slice(0, 10)
  assert.equal(teamStatus(comp(partial), false), 'in_progress')
  assert.equal(teamStatus(comp(partial), true), 'incomplete_unranked')
  assert.equal(teamStatus(comp([]), false), 'not_started')
  const nr = full(); nr[0] = sc('h1', null, true)
  assert.equal(teamStatus(comp(nr), true), 'needs_attention')
  assert.equal(teamStatus(comp(full()), true), 'complete')
})
const team = (entryId: string, name: string, scores: TeamHoleScore[], hcp: number | null): LeaderboardTeam => {
  const completion = comp(scores); return { entryId, name, teamHandicap: hcp, completion, gross: grossTotal(holes, scores) }
}
test('gross leaderboard ranks only eligible teams, ties share a rank, unranked listed with reasons', () => {
  const nr = full(); nr[0] = sc('h1', null, true)
  const lb = buildLeaderboard([
    team('1', 'Eagles', full(4), 5), team('2', 'Birdies', full(4), 7), team('3', 'Pars', full(5), 2),
    team('4', 'Pickups', nr, 0), team('5', 'Short', full().slice(0, 12), 0),
  ], 'gross', false)!
  assert.deepEqual(lb.ranked.map(r => [r.name, r.rank, r.tied]), [['Birdies', 1, true], ['Eagles', 1, true], ['Pars', 3, false]])
  assert.deepEqual(lb.unranked.map(u => u.name), ['Pickups', 'Short'])
  assert.match(lb.unranked[0].reason, /No Return/)
  assert.match(lb.unranked[1].reason, /6 holes not scored/)
})
test('net leaderboard is refused until explicitly enabled; then it ranks on exact one-decimal net', () => {
  const teams = [team('1', 'A', full(4), 5), team('2', 'B', full(4), 7.5), team('3', 'C', full(4), null)]
  assert.equal(buildLeaderboard(teams, 'net', false), null)
  const lb = buildLeaderboard(teams, 'net', true)!
  assert.deepEqual(lb.ranked.map(r => [r.name, r.net]), [['B', 64.5], ['A', 67]])
  assert.equal(lb.unranked[0].name, 'C'); assert.equal(lb.unranked[0].reason, 'No team handicap set')
})
test('drive progress and risk message', () => {
  const roster = [{ playerId: 'a', name: 'Ann' }, { playerId: 'b', name: 'Bo' }]
  assert.equal(driveProgress(roster, ['a'], null), null)
  const rows = driveProgress(roster, ['a', 'a', 'b'], 2)!
  assert.deepEqual(rows.map(r => [r.used, r.met]), [[2, true], [1, false]])
  assert.match(driveRiskMessage(rows, 10)!, /1 more drive needed from Bo/)
  assert.match(driveRiskMessage(rows, 0)!, /can no longer be met/)
  assert.equal(driveRiskMessage(driveProgress(roster, ['a', 'a', 'b', 'b'], 2), 5), null)
})
