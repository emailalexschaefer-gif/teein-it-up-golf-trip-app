import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTeamSyncRunner, type TeamResponseLike, type TeamSyncDeps } from './teamSyncRunner'
import type { TeamQueueEntry } from './teamQueueRules'

let seq = 0
const mk = (o: Partial<TeamQueueEntry> = {}): TeamQueueEntry => ({ clientId: `c${++seq}`, entryId: 'e', holeId: `h${seq}`, grossScore: 4, isNoReturn: false, drivePlayerId: null, baseRevision: 0, enteredAt: new Date(2026, 9, 27, 0, 0, seq).toISOString(), syncStatus: 'pending', retryCount: 0, ...o })
const resp = (status: number, body: unknown, extra: Partial<TeamResponseLike> = {}): TeamResponseLike => ({ ok: status >= 200 && status < 300, status, json: async () => body, ...extra })

function harness(rows: TeamQueueEntry[], script: (req: { body: Record<string, unknown> }, n: number) => TeamResponseLike | Error) {
  const store = new Map(rows.map(r => [r.clientId, r]))
  const calls: Record<string, unknown>[] = []
  const reports: string[] = []
  let ids = 0
  const deps: TeamSyncDeps = {
    allEntries: async () => [...store.values()],
    recoverInterrupted: async () => 0,
    patch: async (id, p) => { const r = store.get(id); if (r) store.set(id, { ...r, ...p }) },
    replaceWithRebased: async (old, nr) => { store.delete(old); store.set(nr.clientId, nr) },
    newId: () => `new${++ids}`, nowIso: () => '2026-10-27T01:00:00.000Z',
    fetchFn: async (_u, init) => { const body = JSON.parse(init.body) as Record<string, unknown>; calls.push(body); const r = script({ body }, calls.length); if (r instanceof Error) throw r; return r },
    report: { pending: n => reports.push(`pending:${n}`), attention: n => reports.push(`attention:${n}`), failed: m => reports.push(`failed:${m}`), complete: () => reports.push('complete'), syncing: v => reports.push(`syncing:${v}`) },
    timeoutMs: 500,
  }
  return { run: createTeamSyncRunner(deps), store, calls, reports }
}

test('success marks synced and sends snake_case body with base_revision', async () => {
  const a = mk()
  const h = harness([a], () => resp(200, { outcome: 'inserted', revision: 1, gross_score: 4, is_no_return: false }))
  await h.run()
  assert.equal(h.store.get(a.clientId)!.syncStatus, 'synced')
  assert.deepEqual(h.calls[0], { client_id: a.clientId, entry_id: 'e', hole_id: a.holeId, gross_score: 4, is_no_return: false, drive_player_id: null, base_revision: 0 })
  assert.ok(h.reports.includes('complete'))
})
test('a 200 that does not echo the sent score is NOT believed', async () => {
  const a = mk()
  const h = harness([a], () => resp(200, { outcome: 'updated', revision: 2, gross_score: 9, is_no_return: false }))
  await h.run()
  assert.equal(h.store.get(a.clientId)!.syncStatus, 'error'); assert.match(h.store.get(a.clientId)!.lastError!, /different score/)
})
test('HTML 200 / unreadable body keeps the score queued', async () => {
  const a = mk()
  const h = harness([a], () => ({ ok: true, status: 200, json: async () => { throw new Error('not json') } }))
  await h.run()
  assert.equal(h.store.get(a.clientId)!.syncStatus, 'error')
})
test('conflict is kept with the server value, never overwritten, and not retried', async () => {
  const a = mk({ baseRevision: 1 })
  let n = 0
  const h = harness([a], () => { n++; return resp(409, { outcome: 'conflict', revision: 3, gross_score: 6, is_no_return: false }) })
  await h.run(); await h.run()
  const r = h.store.get(a.clientId)!
  assert.equal(r.syncStatus, 'conflict'); assert.deepEqual(r.conflict, { serverRevision: 3, serverGross: 6, serverNoReturn: false, locked: false }); assert.equal(n, 1)
  assert.ok(h.reports.includes('attention:1'))
})
test('organiser lock is a locked conflict', async () => {
  const a = mk()
  const h = harness([a], () => resp(409, { outcome: 'locked', revision: 4, gross_score: 5, is_no_return: false }))
  await h.run()
  assert.equal(h.store.get(a.clientId)!.conflict!.locked, true)
})
test('permanent refusals are kept, rejected, visible; continue with the next entry', async () => {
  const a = mk(), b = mk()
  const h = harness([a, b], ({ body }) => body.client_id === a.clientId ? resp(403, { outcome: 'not_authorised' }) : resp(200, { outcome: 'inserted', revision: 1, gross_score: 4, is_no_return: false }))
  await h.run()
  assert.equal(h.store.get(a.clientId)!.syncStatus, 'rejected'); assert.match(h.store.get(a.clientId)!.lastError!, /not the scorer/)
  assert.equal(h.store.get(b.clientId)!.syncStatus, 'synced')
})
test('own-write rebase: lost acknowledgement then follow-up edit does not become a false conflict', async () => {
  const a = mk({ grossScore: 5, baseRevision: 2, priorSent: [{ grossScore: 4, isNoReturn: false, drivePlayerId: null, revisionIfLanded: 3 }] })
  const h = harness([a], (_r, n) => n === 1 ? resp(409, { outcome: 'conflict', revision: 3, gross_score: 4, is_no_return: false }) : resp(200, { outcome: 'updated', revision: 4, gross_score: 5, is_no_return: false }))
  await h.run(); assert.equal(h.store.get('new1')!.baseRevision, 3); assert.equal(h.store.has(a.clientId), false)
  await h.run(); assert.equal(h.store.get('new1')!.syncStatus, 'synced')
})
test('network failure halts the pass after ONE request and keeps everything queued', async () => {
  const rows = [mk(), mk(), mk()]
  const h = harness(rows, () => new Error('Failed to fetch'))
  await h.run()
  assert.equal(h.calls.length, 1)
  assert.deepEqual(rows.map(r => h.store.get(r.clientId)!.syncStatus), ['error', 'pending', 'pending'])
  assert.ok(h.reports.some(r => r.startsWith('failed:3 team score(s) pending sync')))
})
test('signed out (401) halts, says so, keeps scores; a bare 405 is described, not called "signed out"', async () => {
  const a = mk(), b = mk()
  const h = harness([a, b], () => resp(401, { error: 'Not authenticated' }))
  await h.run(); assert.equal(h.calls.length, 1); assert.match(h.store.get(a.clientId)!.lastError!, /Signed out/)
  const c = mk()
  const h2 = harness([c], () => resp(405, {}, { url: 'https://x.test/api/team-scores' }))
  await h2.run(); assert.match(h2.store.get(c.clientId)!.lastError!, /HTTP 405 at \/api\/team-scores/); assert.doesNotMatch(h2.store.get(c.clientId)!.lastError!, /Signed out/)
})
test('redirect to /login is an established sign-out; redirect elsewhere is not', async () => {
  const a = mk(); const h = harness([a], () => resp(200, {}, { redirected: true, url: 'https://x.test/login?next=/' }))
  await h.run(); assert.match(h.store.get(a.clientId)!.lastError!, /Signed out/)
  const b = mk(); const h2 = harness([b], () => resp(200, {}, { redirected: true, url: 'https://x.test/maintenance' }))
  await h2.run(); assert.doesNotMatch(h2.store.get(b.clientId)!.lastError!, /Signed out/)
})
test('unknown outcome string is rejected visibly, not treated as success', async () => {
  const a = mk(); const h = harness([a], () => resp(200, { outcome: 'banana', revision: 1 }))
  await h.run(); assert.equal(h.store.get(a.clientId)!.syncStatus, 'rejected')
})
test('reentrancy: a second run while one is in flight does nothing', async () => {
  const a = mk(); let release!: () => void
  const gate = new Promise<void>(r => { release = r })
  const h = harness([a], () => resp(200, { outcome: 'inserted', revision: 1, gross_score: 4, is_no_return: false }))
  const slowFetch = h.run
  const p1 = slowFetch(); const p2 = slowFetch(); release(); await gate; await Promise.all([p1, p2])
  assert.equal(h.calls.length, 1)
})
