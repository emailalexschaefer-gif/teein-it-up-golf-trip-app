import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHoleCells, validateGross, nextHoleToScore, progressSummary, syncSummary, type HoleInfo, type ServerHoleScore } from './scorerModel'
import type { TeamQueueEntry } from './teamQueueRules'

const holes: HoleInfo[] = [3, 1, 2].map(n => ({ holeId: `h${n}`, number: n, par: 4 }))
const srv = (o: Partial<ServerHoleScore> & { holeId: string }): ServerHoleScore => ({ grossScore: 4, isNoReturn: false, nrTreatment: null, revision: 1, locked: false, drivePlayerId: null, ...o })
const q = (o: Partial<TeamQueueEntry> & { holeId: string }): TeamQueueEntry => ({ clientId: 'c' + Math.random(), entryId: 'e', grossScore: 5, isNoReturn: false, drivePlayerId: null, baseRevision: 0,
  enteredAt: '2026-10-28T01:00:00Z', syncStatus: 'pending', retryCount: 0, ...o })

test('cells are ordered by hole number and start empty', () => {
  const c = buildHoleCells(holes, [], [], [])
  assert.deepEqual(c.map(x => x.number), [1, 2, 3]); assert.ok(c.every(x => x.state === 'empty' && x.revision === 0))
})
test('validateGross accepts 1-20 integers only', () => {
  assert.equal(validateGross(4).ok, true); assert.equal(validateGross(20).ok, true)
  for (const bad of [0, 21, 3.5, NaN, '4', null, undefined]) assert.equal(validateGross(bad).ok, false, String(bad))
})
test('server score shows as scored with its revision; locked is marked', () => {
  const c = buildHoleCells(holes, [srv({ holeId: 'h1', revision: 3 }), srv({ holeId: 'h2', locked: true })], [], [])
  assert.equal(c[0].state, 'scored'); assert.equal(c[0].revision, 3); assert.equal(c[1].state, 'locked')
})
test('queued value shows as offline_saved/saving and overrides the server value for display', () => {
  const c = buildHoleCells(holes, [srv({ holeId: 'h1', grossScore: 4 })], [q({ holeId: 'h1', grossScore: 6 }), q({ holeId: 'h2', syncStatus: 'syncing' })], [])
  assert.equal(c[0].state, 'offline_saved'); assert.equal(c[0].gross, 6); assert.equal(c[1].state, 'saving')
})
test('a synced queue row does not hide the server value', () => {
  const c = buildHoleCells(holes, [srv({ holeId: 'h1', grossScore: 4, revision: 2 })], [q({ holeId: 'h1', syncStatus: 'synced', grossScore: 4 })], [])
  assert.equal(c[0].state, 'scored')
})
test('conflict and organiser lock need action and explain themselves', () => {
  const c = buildHoleCells(holes, [], [
    q({ holeId: 'h1', syncStatus: 'conflict', conflict: { serverRevision: 2, serverGross: 3, serverNoReturn: false, locked: false } }),
    q({ holeId: 'h2', syncStatus: 'conflict', conflict: { serverRevision: 2, serverGross: 3, serverNoReturn: false, locked: true } })], [])
  assert.equal(c[0].state, 'conflict'); assert.match(c[0].note!, /to 3/); assert.equal(c[0].needsAction, true)
  assert.equal(c[1].state, 'locked'); assert.equal(c[1].needsAction, true)
})
test('No Return is never given a score; unresolved vs resolved wording differs', () => {
  const c = buildHoleCells(holes, [srv({ holeId: 'h1', grossScore: null, isNoReturn: true }), srv({ holeId: 'h2', grossScore: null, isNoReturn: true, nrTreatment: 'no_score' })], [], [])
  assert.equal(c[0].state, 'no_return'); assert.equal(c[0].gross, null); assert.equal(c[1].state, 'no_return_resolved')
  assert.equal(progressSummary(c).done, 0)
})
test('rejected rows surface their error and flags are carried', () => {
  const c = buildHoleCells(holes, [], [q({ holeId: 'h1', syncStatus: 'rejected', lastError: 'You are not the scorer for this team.' })], ['h2'])
  assert.equal(c[0].state, 'rejected'); assert.match(c[0].note!, /not the scorer/); assert.equal(c[1].flagged, true)
})
test('next hole: needs-action first, then first empty, else null', () => {
  const cells = buildHoleCells(holes, [srv({ holeId: 'h1' })], [], [])
  assert.equal(nextHoleToScore(cells)?.number, 2)
  const done = buildHoleCells(holes, holes.map(h => srv({ holeId: h.holeId })), [], [])
  assert.equal(nextHoleToScore(done), null)
  const withConflict = buildHoleCells(holes, [srv({ holeId: 'h1' })], [q({ holeId: 'h3', syncStatus: 'conflict', conflict: { serverRevision: 2, serverGross: 3, serverNoReturn: false, locked: false } })], [])
  assert.equal(nextHoleToScore(withConflict)?.number, 3)
})
test('progress counts only real scores and totals running gross', () => {
  const c = buildHoleCells(holes, [srv({ holeId: 'h1', grossScore: 4 }), srv({ holeId: 'h2', grossScore: 5 })], [], [])
  const p = progressSummary(c); assert.equal(p.done, 2); assert.equal(p.total, 3); assert.equal(p.runningGross, 9); assert.equal(p.label, '2 of 3 holes')
})
test('sync summary prioritises conflicts, then rejected, then pending', () => {
  assert.equal(syncSummary([]).banner.tone, 'ok')
  assert.equal(syncSummary([q({ holeId: 'h1' })]).banner.tone, 'info')
  assert.equal(syncSummary([q({ holeId: 'h1', syncStatus: 'rejected' }), q({ holeId: 'h2' })]).banner.tone, 'warn')
  const s = syncSummary([q({ holeId: 'h1', syncStatus: 'conflict' }), q({ holeId: 'h2', syncStatus: 'rejected' })])
  assert.equal(s.conflicts, 1); assert.match(s.banner.text, /needs? your decision/)
})
