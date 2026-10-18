import test from 'node:test'
import assert from 'node:assert/strict'
import type { OfflineScoreEntry } from '../../types/app'
import { decideScoreWrite, type ExistingScoreRow } from './scoreWriteDecision'
import { validateScoreAck, type AckResponseLike } from '../db/scoreAck'
import {
  planQueueWrite, isInterruptedSyncing, latestPerKey, classifyHttpFailure,
  withTimeout, TimeoutError, SYNCING_STALE_MS,
} from '../db/queueRules'
import { createSyncRunner, type SyncDeps } from '../db/syncRunner'
import { deriveSyncStatus, canConfirmRound } from '../db/syncStatus'

/**
 * Offline-scoring Phase B regression suite (16 Oct).
 *
 * IMPORTANT — what this does and does not prove. dexie.ts (IndexedDB) and
 * the /api/scores route need a browser / Next / Supabase and cannot run in
 * the test sandbox. Everything that DECIDES behaviour was extracted into
 * pure modules (queueRules, syncRunner, scoreAck, scoreWriteDecision,
 * syncStatus) and is tested here against an in-memory queue and an
 * in-memory model of the server. The thin Dexie / route glue that calls
 * those modules is checked statically (see offlineScoringPhaseBWiring.test.ts)
 * and must be verified on real phones.
 */

// ── In-memory models ─────────────────────────────────────────────────────

const SC = 'scorecard-1'
const H = (n: number) => `hole-${n}`

class FakeQueue {
  rows = new Map<string, OfflineScoreEntry>()
  clock = Date.parse('2026-10-17T01:00:00.000Z')
  private seq = 0

  tick(ms = 1000) { this.clock += ms; return new Date(this.clock).toISOString() }

  /** Mirrors dexie.queueScoreEntry: same planner, in-memory table. */
  queue(hole: number, gross: number | null, opts: { role?: 'self' | 'marker'; scorecardId?: string; pickedUp?: boolean } = {}): string {
    const role = opts.role ?? 'self'
    const scorecardId = opts.scorecardId ?? SC
    const rowsForKey = [...this.rows.values()].filter(r => r.scorecardId === scorecardId && r.holeId === H(hole) && r.captureRole === role)
    const plan = planQueueWrite(rowsForKey, {
      scorecardId, holeId: H(hole), captureRole: role,
      grossScore: opts.pickedUp ? null : gross, isNoReturn: !!opts.pickedUp, enteredAt: this.tick(),
    }, this.clock, () => `client-${++this.seq}`)
    if (plan.action === 'noop') return plan.clientId
    this.rows.set(plan.row.clientId, plan.row)
    for (const id of plan.deleteClientIds) if (id !== plan.row.clientId) this.rows.delete(id)
    return plan.row.clientId
  }

  count(status: string) { return [...this.rows.values()].filter(r => r.syncStatus === status).length }
  get(id: string) { return this.rows.get(id)! }

  deps(over: Partial<SyncDeps> & { fetchFn: SyncDeps['fetchFn'] }, reports: Reports): SyncDeps {
    return {
      getPendingEntries: async () => [...this.rows.values()].filter(r => r.syncStatus === 'pending' || r.syncStatus === 'error').sort((a, b) => Date.parse(a.enteredAt) - Date.parse(b.enteredAt)),
      recoverInterrupted: async () => {
        let n = 0
        for (const r of this.rows.values()) if (isInterruptedSyncing(r, this.clock)) { r.syncStatus = 'pending'; r.syncStartedAt = undefined; n++ }
        return n
      },
      markSyncing: async id => { const r = this.rows.get(id); if (r) { r.syncStatus = 'syncing'; r.syncStartedAt = new Date(this.clock).toISOString(); r.sendAttempts = (r.sendAttempts ?? 0) + 1 } },
      markSynced: async (id, sent) => { const r = this.rows.get(id); if (r && r.grossScore === sent.grossScore && r.isNoReturn === sent.isNoReturn) r.syncStatus = 'synced' },
      markError: async (id, m) => { const r = this.rows.get(id); if (r) { r.syncStatus = 'error'; r.retryCount++; r.lastError = m } },
      markRejected: async (id, m) => { const r = this.rows.get(id); if (r) { r.syncStatus = 'rejected'; r.lastError = m } },
      markConflict: async (id, sent, server) => { const r = this.rows.get(id); if (r && r.grossScore === sent.grossScore && r.isNoReturn === sent.isNoReturn) { r.syncStatus = 'rejected'; r.conflict = { serverGross: server.grossScore, serverNoReturn: server.isNoReturn, serverEnteredAt: server.enteredAt } } },
      getPendingCount: async () => [...this.rows.values()].filter(r => ['pending', 'error', 'syncing'].includes(r.syncStatus)).length,
      getRejectedCount: async () => this.count('rejected'),
      report: reports.api,
      timeoutMs: 40,
      ...over,
    }
  }
}

interface ServerRow { id: string; scorecard_id: string; hole_id: string; capture_role: string; gross_score: number | null; is_no_return: boolean; client_id: string; entered_at: string }

/** Model of POST /api/scores' write section (decision function is the real one). */
class FakeServer {
  rows = new Map<string, ServerRow>()
  calls: Array<Record<string, unknown>> = []
  private id = 0
  handle(body: Record<string, unknown>): { status: number; body: unknown } {
    this.calls.push(body)
    const key = `${body.scorecard_id}:${body.hole_id}:${body.capture_role}`
    const existing = this.rows.get(key) ?? null
    const incoming = { client_id: body.client_id as string, entered_at: body.entered_at as string, gross_score: body.gross_score as number | null, is_no_return: body.is_no_return as boolean }
    const d = decideScoreWrite(existing as ExistingScoreRow | null, incoming)
    if (d.action === 'duplicate') return { status: 200, body: { ...existing, message: 'Already recorded', conflict: true, duplicate: true } }
    if (d.action === 'stale') return { status: 200, body: { ...existing, message: 'A newer score is already recorded', stale: true } }
    const row: ServerRow = {
      id: existing?.id ?? `row-${++this.id}`, scorecard_id: body.scorecard_id as string, hole_id: body.hole_id as string,
      capture_role: body.capture_role as string, gross_score: incoming.gross_score, is_no_return: incoming.is_no_return,
      client_id: incoming.client_id, entered_at: incoming.entered_at,
    }
    this.rows.set(key, row)
    return { status: 201, body: row }
  }
  value(hole: number, role = 'self'): number | null | undefined { return this.rows.get(`${SC}:${H(hole)}:${role}`)?.gross_score }
}

function res(status: number, body: unknown, over: Partial<AckResponseLike> & { contentType?: string | null } = {}): AckResponseLike {
  const ct = over.contentType === undefined ? 'application/json' : over.contentType
  return {
    ok: status >= 200 && status < 300, status, redirected: over.redirected ?? false,
    headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? ct : null) },
    json: over.json ?? (async () => body),
  }
}

class Reports {
  pending = -1; rejected = -1; completes = 0; fails: Array<{ msg: string; kind: string }> = []; syncing: boolean[] = []
  api = {
    syncing: (v: boolean) => { this.syncing.push(v) },
    pendingCount: (n: number) => { this.pending = n },
    rejectedCount: (n: number) => { this.rejected = n },
    complete: () => { this.completes++ },
    failed: (msg: string, kind: string) => { this.fails.push({ msg, kind }) },
  }
}

function serverFetch(server: FakeServer): SyncDeps['fetchFn'] {
  return async (_url, init) => { const r = server.handle(JSON.parse(init.body)); return res(r.status, r.body) }
}

// ── D1: score corrections / idempotency / ordering ───────────────────────

test('D1: editing a queued score that has never been sent replaces it in place', () => {
  const q = new FakeQueue()
  const id1 = q.queue(3, 5)
  const id2 = q.queue(3, 4)
  assert.equal(id1, id2, 'same clientId — it never left the device')
  assert.equal(q.rows.size, 1)
  assert.equal(q.get(id1).grossScore, 4)
  assert.equal(q.get(id1).sendAttempts, 0)
})

test('D1: re-saving the same value is a no-op (no duplicate row, no new request)', () => {
  const q = new FakeQueue()
  const a = q.queue(3, 5)
  const b = q.queue(3, 5)
  assert.equal(a, b)
  assert.equal(q.rows.size, 1)
})

test('D1: editing after the entry may have reached the server gets a NEW clientId and retires the old one', async () => {
  const q = new FakeQueue(); const server = new FakeServer(); const rep = new Reports()
  const id1 = q.queue(4, 5)
  // Request reaches the server, but the reply is lost (network error to the client).
  const lostReply: SyncDeps['fetchFn'] = async (_u, init) => { server.handle(JSON.parse(init.body)); throw new TypeError('Failed to fetch') }
  await createSyncRunner(q.deps({ fetchFn: lostReply }, rep))()
  assert.equal(server.value(4), 5, 'server has the first value')
  assert.equal(q.get(id1).syncStatus, 'error')
  assert.equal(q.get(id1).sendAttempts, 1)

  const id2 = q.queue(4, 4) // player corrects the score
  assert.notEqual(id2, id1, 'must NOT reuse a clientId the server may have recorded')
  assert.equal(q.rows.has(id1), false, 'superseded row retired')

  await createSyncRunner(q.deps({ fetchFn: serverFetch(server) }, rep))()
  assert.equal(server.value(4), 4, 'THE BUG: the correction must reach the server')
  assert.equal(q.get(id2).syncStatus, 'synced')
})

test('D1: an edit made while a request is in flight reaches the server (latest intended score wins)', async () => {
  const q = new FakeQueue(); const server = new FakeServer(); const rep = new Reports()
  q.queue(2, 5)
  let release!: () => void
  const gate = new Promise<void>(r => { release = r })
  const slowFirst: SyncDeps['fetchFn'] = async (_u, init) => {
    const body = JSON.parse(init.body)
    const r = server.handle(body)      // server stores 5 …
    await gate                          // … but the reply is slow
    return res(r.status, r.body)
  }
  const runner = createSyncRunner(q.deps({ fetchFn: slowFirst, timeoutMs: 5000 }, rep))
  const pass1 = runner()
  await new Promise(r => setTimeout(r, 5))
  const editedId = q.queue(2, 4)       // player edits to 4 mid-flight
  const second = runner()              // arrives mid-pass -> schedules another pass
  release()
  await Promise.all([pass1, second])
  // switch to a normal network for the follow-up pass the runner scheduled
  await createSyncRunner(q.deps({ fetchFn: serverFetch(server) }, rep))()
  assert.equal(server.value(2), 4)
  assert.equal(q.get(editedId).syncStatus, 'synced')
  assert.equal(q.count('pending') + q.count('error') + q.count('syncing'), 0)
})

test('D1: out-of-order arrival — an older request landing AFTER a newer correction cannot overwrite it', () => {
  const server = new FakeServer()
  const base = { scorecard_id: SC, hole_id: H(7), capture_role: 'self', is_no_return: false }
  const t1 = '2026-10-17T01:00:01.000Z'; const t2 = '2026-10-17T01:00:05.000Z'
  // correction (4 @ t2) reaches the server FIRST, then the stale original (5 @ t1)
  const r1 = server.handle({ ...base, gross_score: 4, client_id: 'new', entered_at: t2 })
  assert.equal(r1.status, 201)
  const r2 = server.handle({ ...base, gross_score: 5, client_id: 'old', entered_at: t1 })
  assert.equal(r2.status, 200)
  assert.equal((r2.body as { stale?: boolean }).stale, true)
  assert.equal(server.value(7), 4, 'latest intended score wins regardless of arrival order')
})

test('D1: decideScoreWrite — insert / update / duplicate / stale / equal timestamps / legacy same-client_id edit', () => {
  const row: ExistingScoreRow = { id: 'r', client_id: 'c1', entered_at: '2026-10-17T01:00:10.000Z', gross_score: 5, is_no_return: false }
  const inc = (over: Partial<{ client_id: string; entered_at: string; gross_score: number | null; is_no_return: boolean }>) =>
    ({ client_id: 'c1', entered_at: '2026-10-17T01:00:10.000Z', gross_score: 5, is_no_return: false, ...over })
  assert.deepEqual(decideScoreWrite(null, inc({})), { action: 'insert' })
  assert.equal(decideScoreWrite(row, inc({})).action, 'duplicate', 'identical resend')
  assert.equal(decideScoreWrite(row, inc({ entered_at: '2026-10-17T01:00:09.000Z', client_id: 'c0', gross_score: 3 })).action, 'stale')
  assert.equal(decideScoreWrite(row, inc({ entered_at: '2026-10-17T01:00:11.000Z', client_id: 'c2', gross_score: 4 })).action, 'update')
  assert.equal(decideScoreWrite(row, inc({ entered_at: '2026-10-17T01:00:10.000Z', client_id: 'c2', gross_score: 4 })).action, 'update', 'equal timestamp from a different request is not stale')
  // Legacy client: same client_id, DIFFERENT value, newer -> must update (this is the original D1 bug)
  assert.equal(decideScoreWrite(row, inc({ entered_at: '2026-10-17T01:00:20.000Z', gross_score: 4 })).action, 'update')
  // …but an OLD legacy resend with a different value is stale
  assert.equal(decideScoreWrite(row, inc({ entered_at: '2026-10-17T01:00:01.000Z', gross_score: 3 })).action, 'stale')
  // pick-up vs number
  assert.equal(decideScoreWrite(row, inc({ entered_at: '2026-10-17T01:00:12.000Z', client_id: 'c3', gross_score: null, is_no_return: true })).action, 'update')
  // unparseable/absent stored time never blocks a write
  assert.equal(decideScoreWrite({ ...row, entered_at: null }, inc({ client_id: 'c9', gross_score: 6 })).action, 'update')
})

test('D1: enteredAt is strictly increasing per key even if the device clock goes backwards', () => {
  const q = new FakeQueue()
  const id = q.queue(1, 5)
  const first = q.get(id).enteredAt
  q.clock -= 60_000 // clock moved back a minute
  const rowsForKey = [...q.rows.values()]
  const plan = planQueueWrite(rowsForKey, { scorecardId: SC, holeId: H(1), captureRole: 'self', grossScore: 4, isNoReturn: false, enteredAt: new Date(q.clock).toISOString() }, q.clock, () => 'x')
  assert.equal(plan.action, 'put')
  if (plan.action === 'put') assert.ok(Date.parse(plan.row.enteredAt) > Date.parse(first))
})

test('D1: self and marker entries for the same hole are never merged', () => {
  const q = new FakeQueue()
  const s = q.queue(5, 4, { role: 'self' })
  const m = q.queue(5, 5, { role: 'marker' })
  assert.notEqual(s, m)
  assert.equal(q.rows.size, 2)
})

test('D1: overlay picks the newest row deterministically (a refused row never hides a newer edit)', () => {
  const mk = (id: string, at: string, status: OfflineScoreEntry['syncStatus'], gross: number): OfflineScoreEntry =>
    ({ clientId: id, scorecardId: SC, holeId: H(1), captureRole: 'self', grossScore: gross, isNoReturn: false, enteredAt: at, syncStatus: status, retryCount: 0 })
  const rows = [mk('b', '2026-10-17T01:00:09.000Z', 'pending', 4), mk('a', '2026-10-17T01:00:01.000Z', 'rejected', 5)]
  assert.equal(latestPerKey(rows).get(`${SC}:${H(1)}:self`)!.clientId, 'b')
  assert.equal(latestPerKey(rows.slice().reverse()).get(`${SC}:${H(1)}:self`)!.clientId, 'b')
})

// ── D2: stranded syncing entries ─────────────────────────────────────────

test('D2: an entry abandoned in "syncing" is recovered, counted as pending, and then synced exactly once', async () => {
  const q = new FakeQueue(); const server = new FakeServer(); const rep = new Reports()
  const id = q.queue(6, 4)
  // simulate: request started, page killed
  const r = q.get(id); r.syncStatus = 'syncing'; r.sendAttempts = 1; r.syncStartedAt = new Date(q.clock - SYNCING_STALE_MS - 1000).toISOString()
  assert.equal(await q.deps({ fetchFn: serverFetch(server) }, rep).getPendingCount(), 1, 'in-flight/abandoned entries count as pending')
  await createSyncRunner(q.deps({ fetchFn: serverFetch(server) }, rep))()
  assert.equal(server.value(6), 4)
  assert.equal(q.get(id).syncStatus, 'synced')
  assert.equal(server.calls.length, 1, 'one request — no duplicate')
})

test('D2: a legacy "syncing" row with no start time is treated as interrupted; a fresh one is not (unless forced)', () => {
  const base: OfflineScoreEntry = { clientId: 'c', scorecardId: SC, holeId: H(1), captureRole: 'self', grossScore: 4, isNoReturn: false, enteredAt: '2026-10-17T01:00:00.000Z', syncStatus: 'syncing', retryCount: 0 }
  const now = Date.parse('2026-10-17T01:00:10.000Z')
  assert.equal(isInterruptedSyncing(base, now), true, 'no syncStartedAt')
  assert.equal(isInterruptedSyncing({ ...base, syncStartedAt: '2026-10-17T01:00:05.000Z' }, now), false, 'started 5 s ago')
  assert.equal(isInterruptedSyncing({ ...base, syncStartedAt: '2026-10-17T01:00:05.000Z' }, now, true), true, 'forced at startup')
  assert.equal(isInterruptedSyncing({ ...base, syncStatus: 'pending' }, now, true), false)
})

test('D2: recovery plus a later edit cannot overwrite the newer score (server orders by enteredAt)', async () => {
  const q = new FakeQueue(); const server = new FakeServer(); const rep = new Reports()
  const id = q.queue(8, 5)
  const r = q.get(id); r.syncStatus = 'syncing'; r.sendAttempts = 1; r.syncStartedAt = undefined
  const edited = q.queue(8, 4)       // player corrects while the old one was stranded
  assert.notEqual(edited, id)
  await createSyncRunner(q.deps({ fetchFn: serverFetch(server) }, rep))()
  assert.equal(server.value(8), 4)
  assert.equal(server.calls.length, 1)
})

// ── D3: timeout ──────────────────────────────────────────────────────────

test('D3: a hung request is aborted after the timeout, the score stays queued, and the next pass is not blocked', async () => {
  const q = new FakeQueue(); const server = new FakeServer(); const rep = new Reports()
  const id = q.queue(1, 4); q.queue(2, 5)
  let aborted = false
  const hang: SyncDeps['fetchFn'] = (_u, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => { aborted = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) })
  })
  const t0 = Date.now()
  // Guarded so that if the timeout is ever removed this FAILS instead of hanging the suite.
  await withTimeout(createSyncRunner(q.deps({ fetchFn: hang, timeoutMs: 30 }, rep))(), 2000)
  assert.equal(aborted, true)
  assert.ok(Date.now() - t0 < 1500, 'pass ends promptly')
  assert.equal(q.get(id).syncStatus, 'error')
  assert.match(q.get(id).lastError ?? '', /Timed out/)
  assert.equal(rep.pending, 2, 'both scores still owed — nothing lost')
  assert.equal(server.calls.length, 0)
  assert.equal(rep.fails.at(-1)?.kind, 'network')
  // later pass, connection back
  await createSyncRunner(q.deps({ fetchFn: serverFetch(server) }, rep))()
  assert.equal(server.value(1), 4); assert.equal(server.value(2), 5)
  assert.equal(rep.pending, 0)
})

test('D3: after a network failure the pass stops (one timeout, not one per queued score)', async () => {
  const q = new FakeQueue(); const rep = new Reports()
  for (let h = 1; h <= 6; h++) q.queue(h, 4)
  let calls = 0
  const down: SyncDeps['fetchFn'] = async () => { calls++; throw new TypeError('Failed to fetch') }
  await createSyncRunner(q.deps({ fetchFn: down }, rep))()
  assert.equal(calls, 1)
  assert.equal(q.count('error'), 1)
  assert.equal(q.count('pending'), 5, 'untouched, still queued')
})

test('D3: withTimeout rejects with TimeoutError and passes values through', async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 10), TimeoutError)
  assert.equal(await withTimeout(Promise.resolve(7), 50), 7)
})

test('D3 (edge): retry after timeout when the server DID store the value is safe — no duplicate rows', async () => {
  const q = new FakeQueue(); const server = new FakeServer(); const rep = new Reports()
  const id = q.queue(9, 4)
  const storedThenHang: SyncDeps['fetchFn'] = (_u, init) => new Promise((_, reject) => {
    server.handle(JSON.parse(init.body))
    init.signal.addEventListener('abort', () => reject(new Error('aborted')))
  })
  await createSyncRunner(q.deps({ fetchFn: storedThenHang, timeoutMs: 20 }, rep))()
  assert.equal(q.get(id).syncStatus, 'error')
  await createSyncRunner(q.deps({ fetchFn: serverFetch(server) }, rep))()
  assert.equal(server.rows.size, 1)
  assert.equal(q.get(id).syncStatus, 'synced')
})

// ── D6: acknowledgement validation ───────────────────────────────────────

const exp = { scorecardId: SC, holeId: H(1), captureRole: 'self' as const, grossScore: 4, isNoReturn: false }
const goodRow = { id: 'row-1', scorecard_id: SC, hole_id: H(1), capture_role: 'self', gross_score: 4, is_no_return: false }

test('D6: a genuine acknowledgement is accepted (insert/update, duplicate, stale, and pre-Phase-B duplicate form)', async () => {
  assert.deepEqual(await validateScoreAck(res(201, goodRow), exp), { kind: 'confirmed' })
  assert.deepEqual(await validateScoreAck(res(200, { ...goodRow, message: 'Already recorded', conflict: true, duplicate: true }), exp), { kind: 'confirmed' })
  assert.deepEqual(await validateScoreAck(res(200, { ...goodRow, gross_score: 3, stale: true }), exp), { kind: 'superseded', locked: false, sameValue: false, server: { grossScore: 3, isNoReturn: false, enteredAt: null } })
  assert.deepEqual(await validateScoreAck(res(200, { message: 'Already recorded', conflict: true }), exp), { kind: 'confirmed' })
})

test('D6: HTML, redirects and invalid bodies are NOT confirmation', async () => {
  const html = await validateScoreAck(res(200, '<html>Wi-Fi login</html>', { contentType: 'text/html; charset=utf-8' }), exp)
  assert.equal(html.kind, 'invalid')
  assert.equal((await validateScoreAck(res(200, goodRow, { redirected: true }), exp)).kind, 'invalid')
  assert.equal((await validateScoreAck(res(200, goodRow, { contentType: null }), exp)).kind, 'invalid')
  assert.equal((await validateScoreAck(res(200, goodRow, { json: async () => { throw new SyntaxError('bad') } }), exp)).kind, 'invalid')
  assert.equal((await validateScoreAck(res(200, null), exp)).kind, 'invalid')
  assert.equal((await validateScoreAck(res(200, []), exp)).kind, 'invalid')
  assert.equal((await validateScoreAck(res(200, {}), exp)).kind, 'invalid')
  assert.equal((await validateScoreAck(res(200, { ok: true }), exp)).kind, 'invalid')
  assert.equal((await validateScoreAck(res(200, { ...goodRow, hole_id: H(2) }), exp)).kind, 'invalid', 'ack for a different hole')
  assert.equal((await validateScoreAck(res(200, { ...goodRow, capture_role: 'marker' }), exp)).kind, 'invalid')
  assert.equal((await validateScoreAck(res(200, { ...goodRow, gross_score: 5 }), exp)).kind, 'invalid', 'server stored a different value')
  assert.equal((await validateScoreAck(res(200, { ...goodRow, is_no_return: true, gross_score: null }), exp)).kind, 'invalid')
})

test('D6: a 200 HTML answer leaves the score queued and is reported as a failure, never "synced"', async () => {
  const q = new FakeQueue(); const rep = new Reports()
  const id = q.queue(1, 4)
  const portal: SyncDeps['fetchFn'] = async () => res(200, '<html>login</html>', { contentType: 'text/html' })
  await createSyncRunner(q.deps({ fetchFn: portal }, rep))()
  assert.equal(q.get(id).syncStatus, 'error')
  assert.equal(rep.pending, 1)
  assert.equal(rep.completes, 0)
  assert.equal(rep.fails.at(-1)?.kind, 'invalid')
})

test('D6: a redirected 200 (e.g. middleware -> /login followed by fetch) is not accepted', async () => {
  const q = new FakeQueue(); const rep = new Reports()
  const id = q.queue(1, 4)
  await createSyncRunner(q.deps({ fetchFn: async () => res(200, goodRow, { redirected: true }) }, rep))()
  assert.equal(q.get(id).syncStatus, 'error')
  assert.equal(rep.completes, 0)
})

// ── D7: permanently rejected entries ─────────────────────────────────────

test('D7: a permanent refusal (422) is kept as "rejected", not retried, and not counted as pending', async () => {
  const q = new FakeQueue(); const rep = new Reports()
  const id = q.queue(1, 4)
  let calls = 0
  const refuse: SyncDeps['fetchFn'] = async () => { calls++; return res(422, { error: 'Round is not active' }) }
  await createSyncRunner(q.deps({ fetchFn: refuse }, rep))()
  assert.equal(q.get(id).syncStatus, 'rejected')
  assert.equal(q.get(id).lastError, 'Round is not active')
  assert.equal(rep.pending, 0)
  assert.equal(rep.rejected, 1)
  assert.equal(q.rows.has(id), true, 'never deleted automatically')
  await createSyncRunner(q.deps({ fetchFn: refuse }, rep))()
  assert.equal(calls, 1, 'not retried automatically')
})

test('D7: HTTP classification — 401/408/425/429/5xx and odd non-4xx answers are transient; other 4xx permanent', () => {
  for (const s of [401, 408, 425, 429, 500, 502, 503, 504, 302]) assert.equal(classifyHttpFailure(s), 'transient', String(s))
  for (const s of [400, 403, 404, 409, 422]) assert.equal(classifyHttpFailure(s), 'permanent', String(s))
})

test('D7: a transient server error (500) stays queued and is retried; the other entries are still attempted', async () => {
  const q = new FakeQueue(); const server = new FakeServer(); const rep = new Reports()
  q.queue(1, 4); q.queue(2, 5)
  let n = 0
  const flaky: SyncDeps['fetchFn'] = async (_u, init) => (++n === 1 ? res(500, { error: 'Failed to save score' }) : (() => { const r = server.handle(JSON.parse(init.body)); return res(r.status, r.body) })())
  await createSyncRunner(q.deps({ fetchFn: flaky }, rep))()
  assert.equal(server.rows.size, 1, 'second score still uploaded')
  assert.equal(rep.pending, 1)
  assert.equal(rep.fails.at(-1)?.kind, 'server')
  await createSyncRunner(q.deps({ fetchFn: serverFetch(server) }, rep))()
  assert.equal(rep.pending, 0)
})

test('D7: Round 1 rejected entries do not block Round 2 confirmation, but DO block the round they belong to', () => {
  assert.equal(canConfirmRound({ allMatched: true, pendingCount: 0, rejectedForThisRound: 0 }), true, 'Round 2 with a dead Round 1 entry elsewhere')
  assert.equal(canConfirmRound({ allMatched: true, pendingCount: 0, rejectedForThisRound: 1 }), false, 'its own round')
  assert.equal(canConfirmRound({ allMatched: true, pendingCount: 2, rejectedForThisRound: 0 }), false)
  assert.equal(canConfirmRound({ allMatched: false, pendingCount: 0, rejectedForThisRound: 0 }), false)
})

// ── Connectivity status (what the player is told) ────────────────────────

const st = (over: Partial<Parameters<typeof deriveSyncStatus>[0]>) =>
  deriveSyncStatus({ online: true, syncState: 'idle', pendingCount: 0, rejectedCount: 0, lastFailure: null, ...over })

test('status: every state uses honest wording tied to real queue state', () => {
  assert.equal(st({}).kind, 'idle')
  assert.equal(st({}).label, '')
  assert.equal(st({ syncState: 'synced' }).label, 'All scores synced')
  assert.equal(st({ pendingCount: 2, syncState: 'syncing' }).label, 'Syncing scores…')
  assert.match(st({ pendingCount: 2 }).label, /^Saved on this device — waiting to sync/)
  assert.match(st({ pendingCount: 2, online: false }).label, /^Offline — 2 scores saved on this device, waiting to sync/)
  assert.match(st({ pendingCount: 1, syncState: 'error', lastFailure: 'network' }).label, /No connection to the server — 1 score saved on this device, retrying/)
  assert.match(st({ pendingCount: 1, syncState: 'error', lastFailure: 'invalid' }).label, /^Sync failed — 1 score is still saved on this device/)
  assert.match(st({ pendingCount: 3, syncState: 'error', lastFailure: 'invalid' }).label, /^Sync failed — 3 scores are still saved on this device/)
  assert.match(st({ rejectedCount: 1 }).label, /needs review — not accepted by the server, kept on this device/)
})

test('status: never says "synced" or "saved on this device" unless it is true', () => {
  for (const pendingCount of [1, 3]) for (const syncState of ['idle', 'error'] as const) {
    assert.notEqual(st({ pendingCount, syncState }).kind, 'synced')
  }
  assert.notEqual(st({ syncState: 'synced', rejectedCount: 1 }).kind, 'synced', 'a refused score means not all synced')
  assert.ok(!/saved on this device/i.test(st({ pendingCount: 0, online: false }).label), 'offline with nothing queued must not claim a local save')
  assert.ok(!/synced/i.test(st({ pendingCount: 1, syncState: 'synced' }).label))
})

test('status: the browser online flag alone is not trusted — a failed network pass shows "no connection" even when online=true', () => {
  const v = st({ online: true, pendingCount: 2, syncState: 'error', lastFailure: 'network' })
  assert.equal(v.kind, 'unreachable')
})

// ── Existing normal digital scoring is unchanged ─────────────────────────

test('normal scoring: a full round queued, uploaded and confirmed end-to-end (self + marker), nothing left pending', async () => {
  const q = new FakeQueue(); const server = new FakeServer(); const rep = new Reports()
  for (let h = 1; h <= 18; h++) { q.queue(h, 3 + (h % 3)); q.queue(h, 3 + (h % 3), { role: 'marker', scorecardId: 'scorecard-2' }) }
  await createSyncRunner(q.deps({ fetchFn: serverFetch(server) }, rep))()
  assert.equal(server.rows.size, 36)
  assert.equal(rep.pending, 0); assert.equal(rep.rejected, 0); assert.equal(rep.completes, 1)
  assert.equal(q.count('synced'), 36)
})

test('normal scoring: pick-ups (no return) round-trip with a null gross score', async () => {
  const q = new FakeQueue(); const server = new FakeServer(); const rep = new Reports()
  q.queue(4, null, { pickedUp: true })
  await createSyncRunner(q.deps({ fetchFn: serverFetch(server) }, rep))()
  assert.equal(server.rows.get(`${SC}:${H(4)}:self`)!.is_no_return, true)
  assert.equal(server.value(4), null)
  assert.equal(rep.pending, 0)
})

test('offline then online: scores queued with no network all upload, in order, when the connection returns', async () => {
  const q = new FakeQueue(); const server = new FakeServer(); const rep = new Reports()
  q.queue(3, 4); q.queue(4, 5); q.queue(5, 3)
  const offline: SyncDeps['fetchFn'] = async () => { throw new TypeError('Failed to fetch') }
  await createSyncRunner(q.deps({ fetchFn: offline }, rep))()
  assert.equal(server.rows.size, 0)
  assert.equal(rep.pending, 3, 'all three held locally')
  await createSyncRunner(q.deps({ fetchFn: serverFetch(server) }, rep))()
  assert.deepEqual([server.value(3), server.value(4), server.value(5)], [4, 5, 3])
  assert.deepEqual(server.calls.map(c => c.hole_id), [H(3), H(4), H(5)], 'oldest first')
  assert.equal(rep.pending, 0)
})

test('flapping connection: repeated drop/retry never creates duplicate server rows', async () => {
  const q = new FakeQueue(); const server = new FakeServer(); const rep = new Reports()
  q.queue(1, 4); q.queue(2, 5)
  for (let i = 0; i < 4; i++) {
    const flap: SyncDeps['fetchFn'] = async (_u, init) => { server.handle(JSON.parse(init.body)); throw new TypeError('reply lost') }
    await createSyncRunner(q.deps({ fetchFn: flap }, rep))()
  }
  await createSyncRunner(q.deps({ fetchFn: serverFetch(server) }, rep))()
  assert.equal(server.rows.size, 2)
  assert.equal(q.count('synced'), 2)
  assert.equal(rep.pending, 0)
})
