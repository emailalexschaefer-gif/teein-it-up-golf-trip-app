import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planTeamQueueWrite, interpretAnswer, planTeamConflictResolution, pendingOrder, type TeamQueueEntry } from './teamQueueRules'
import { classifyOutcome } from './outcomes'

let n = 0
const id = () => `id${++n}`
const T = (s: number) => new Date(Date.UTC(2026, 9, 27, 0, 0, s)).toISOString()
const inp = (g: number | null, seen = 0, extra = {}) => ({ entryId: 'e', holeId: 'h', grossScore: g, isNoReturn: g === null, drivePlayerId: null, seenRevision: seen, ...extra })
const row = (over: Partial<TeamQueueEntry> = {}): TeamQueueEntry => ({ clientId: 'c1', entryId: 'e', holeId: 'h', grossScore: 4, isNoReturn: false, drivePlayerId: null, baseRevision: 2, enteredAt: T(1), syncStatus: 'pending', retryCount: 0, ...over })

test('first write carries the revision the scorer saw', () => {
  const p = planTeamQueueWrite([], inp(4, 3), T(1), id)
  assert.equal(p.action, 'write'); if (p.action === 'write') { assert.equal(p.row.baseRevision, 3); assert.equal(p.row.syncStatus, 'pending') }
})
test('identical value is a no-op', () => {
  assert.equal(planTeamQueueWrite([row()], inp(4, 2), T(2), id).action, 'noop')
})
test('edit of a row that never left the device replaces it in place and KEEPS the original base', () => {
  const p = planTeamQueueWrite([row({ baseRevision: 2 })], inp(5, 9), T(2), id)
  assert.equal(p.action, 'write'); if (p.action === 'write') { assert.equal(p.row.clientId, 'c1'); assert.equal(p.row.grossScore, 5); assert.equal(p.row.baseRevision, 2) }
})
test('edit of a row that may have reached the server gets a NEW clientId, keeps the base, remembers what was sent', () => {
  const p = planTeamQueueWrite([row({ syncStatus: 'syncing', syncStartedAt: T(1) })], inp(5, 9), T(3), id)
  assert.equal(p.action, 'write')
  if (p.action === 'write') {
    assert.notEqual(p.row.clientId, 'c1'); assert.deepEqual(p.deleteClientIds, ['c1']); assert.equal(p.row.baseRevision, 2)
    assert.deepEqual(p.row.priorSent, [{ grossScore: 4, isNoReturn: false, drivePlayerId: null, revisionIfLanded: 3 }])
  }
  const err = planTeamQueueWrite([row({ syncStatus: 'error', retryCount: 1 })], inp(6), T(3), id)
  assert.equal(err.action === 'write' && err.row.clientId !== 'c1', true)
})
test('a hole with an unresolved conflict cannot be edited until resolved', () => {
  const p = planTeamQueueWrite([row({ syncStatus: 'conflict', conflict: { serverRevision: 4, serverGross: 6, serverNoReturn: false, locked: false } })], inp(5), T(2), id)
  assert.equal(p.action, 'blocked')
})
test('synced / rejected history does not block a new write', () => {
  assert.equal(planTeamQueueWrite([row({ syncStatus: 'synced' }), row({ clientId: 'c0', syncStatus: 'rejected' })], inp(5, 4), T(2), id).action, 'write')
})
test('answers: success is believed only if it echoes this write', () => {
  const r = row()
  assert.deepEqual(interpretAnswer(r, { outcome: 'inserted', revision: 1, gross_score: 4, is_no_return: false }, classifyOutcome), { kind: 'synced', revision: 1 })
  assert.equal(interpretAnswer(r, { outcome: 'updated', revision: 3, gross_score: 5, is_no_return: false }, classifyOutcome).kind, 'invalid')
  assert.equal(interpretAnswer(r, { outcome: 'updated', gross_score: 4, is_no_return: false }, classifyOutcome).kind, 'invalid')
  assert.deepEqual(interpretAnswer(r, { outcome: 'duplicate', revision: 5 }, classifyOutcome), { kind: 'synced', revision: 5 })
  assert.equal(interpretAnswer(r, { outcome: 'something_new' }, classifyOutcome).kind, 'rejected')
  assert.equal(interpretAnswer(r, { outcome: 'not_authenticated' }, classifyOutcome).kind, 'auth')
  assert.equal(interpretAnswer(r, { outcome: 'round_closed' }, classifyOutcome).kind, 'rejected')
})
test('conflict from someone else is surfaced with the server value; locked is flagged', () => {
  const r = row()
  assert.deepEqual(interpretAnswer(r, { outcome: 'conflict', revision: 5, gross_score: 6, is_no_return: false }, classifyOutcome), { kind: 'conflict', locked: false, serverRevision: 5, serverGross: 6, serverNoReturn: false })
  assert.deepEqual(interpretAnswer(r, { outcome: 'locked', revision: 3, gross_score: 6, is_no_return: false }, classifyOutcome), { kind: 'conflict', locked: true, serverRevision: 3, serverGross: 6, serverNoReturn: false })
})
test('own-write rebase: conflict whose server value is what this device already sent is not a real conflict', () => {
  const r = row({ grossScore: 5, baseRevision: 2, priorSent: [{ grossScore: 4, isNoReturn: false, drivePlayerId: null, revisionIfLanded: 3 }] })
  assert.deepEqual(interpretAnswer(r, { outcome: 'conflict', revision: 3, gross_score: 4, is_no_return: false }, classifyOutcome), { kind: 'rebase', newBaseRevision: 3 })
  // same value but at a revision that does not match where our write would have landed -> a real conflict
  assert.equal(interpretAnswer(r, { outcome: 'conflict', revision: 6, gross_score: 4, is_no_return: false }, classifyOutcome).kind, 'conflict')
})
test('resolution: accept server keeps nothing pending; reapply makes a new row on the server revision; locked cannot be reapplied', () => {
  const c = row({ grossScore: 5, syncStatus: 'conflict', conflict: { serverRevision: 5, serverGross: 6, serverNoReturn: false, locked: false } })
  const a = planTeamConflictResolution(c, 'accept_server', T(9), id)
  assert.equal(a.ok && a.patchOld.resolution, 'accepted_server'); assert.equal(a.ok && a.newRow, undefined)
  const r = planTeamConflictResolution(c, 'reapply_mine', T(9), id)
  assert.equal(r.ok && r.newRow?.baseRevision, 5); assert.equal(r.ok && r.newRow?.grossScore, 5); assert.notEqual(r.ok && r.newRow?.clientId, 'c1')
  const locked = row({ syncStatus: 'conflict', conflict: { serverRevision: 3, serverGross: 6, serverNoReturn: false, locked: true } })
  assert.equal(planTeamConflictResolution(locked, 'reapply_mine', T(9), id).ok, false)
  assert.equal(planTeamConflictResolution(locked, 'accept_server', T(9), id).ok, true)
  assert.equal(planTeamConflictResolution(row(), 'accept_server', T(9), id).ok, false)
})
test('only pending/error rows are uploaded, oldest first; conflicts and rejections stay put', () => {
  const rows = [row({ clientId: 'b', enteredAt: T(5) }), row({ clientId: 'a', enteredAt: T(2), syncStatus: 'error' }), row({ clientId: 'c', syncStatus: 'conflict' }), row({ clientId: 'd', syncStatus: 'rejected' }), row({ clientId: 'e', syncStatus: 'synced' })]
  assert.deepEqual(pendingOrder(rows).map(r => r.clientId), ['a', 'b'])
})
