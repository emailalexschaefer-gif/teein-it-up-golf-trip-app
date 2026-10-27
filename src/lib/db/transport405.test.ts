import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classifyHttpFailure, isTransportRejection } from './queueRules'
import { createSyncRunner, type SyncDeps } from './syncRunner'
import type { OfflineScoreEntry } from '@/types/app'

const mw = readFileSync(join(process.cwd(), 'src/middleware.ts'), 'utf8')
const entry = (o: Partial<OfflineScoreEntry> = {}): OfflineScoreEntry => ({ clientId: 'c1', scorecardId: 's', holeId: 'h', captureRole: 'self', grossScore: 4, isNoReturn: false, enteredAt: '2026-10-26T01:00:00.000Z', syncStatus: 'pending', retryCount: 0, sendAttempts: 0, ...o } as OfflineScoreEntry)

test('405 is never a permanent refusal of a score; real validation refusals still are', () => {
  assert.equal(classifyHttpFailure(405), 'transient')
  for (const s of [400, 403, 404, 409, 422]) assert.equal(classifyHttpFailure(s), 'permanent', String(s))
})

function runnerWith(res: { ok: boolean; status: number; redirected?: boolean; url?: string; body?: unknown }) {
  const calls: string[] = []
  const deps = {
    getPendingEntries: async () => (calls.includes('rejected') || calls.includes('error') ? [] : [entry()]),
    recoverInterrupted: async () => 0, markSyncing: async () => {}, markSynced: async () => { calls.push('synced') },
    markError: async () => { calls.push('error') }, markRejected: async () => { calls.push('rejected') }, markConflict: async () => {},
    getPendingCount: async () => (calls.includes('synced') ? 0 : 1), getRejectedCount: async () => (calls.includes('rejected') ? 1 : 0),
    fetchFn: async () => ({ ok: res.ok, status: res.status, redirected: res.redirected ?? false, url: res.url ?? '', json: async () => res.body ?? {}, headers: new Headers(), text: async () => '' }),
    report: { syncing() {}, pendingCount() {}, rejectedCount() {}, complete() {}, failed(m: string) { calls.push('failed:' + m) } },
  } as unknown as SyncDeps
  return { run: createSyncRunner(deps), calls }
}
test('session lapse (redirect to /login ending in 405): the score stays queued with a clear message, never rejected', async () => {
  const { run, calls } = runnerWith({ ok: false, status: 405, redirected: true, url: 'https://app.example/login?next=%2Fapi%2Fscores' })
  await run()
  assert.ok(!calls.includes('rejected')); assert.ok(calls.includes('error'))
  assert.ok(calls.some(c => c.startsWith('failed:') && /sign in again/i.test(c) && /safe on this device/i.test(c)))
})
test('a bare 405 (no redirect, no sign-in evidence) is NOT labelled signed out: kept queued, visible, diagnosable', async () => {
  const { run, calls } = runnerWith({ ok: false, status: 405, url: 'https://app.example/api/scores' })
  await run()
  assert.ok(!calls.includes('rejected')); assert.ok(calls.includes('error'))
  const msg = calls.find(c => c.startsWith('failed:')) ?? ''
  assert.doesNotMatch(msg, /signed out|sign in again/i)
  assert.match(msg, /HTTP 405/); assert.match(msg, /\/api\/scores/); assert.match(msg, /kept on this device/i)
})
test('a redirect to a non-login page is also not labelled signed out', async () => {
  const { run, calls } = runnerWith({ ok: false, status: 200, redirected: true, url: 'https://app.example/maintenance' })
  await run()
  const msg = calls.find(c => c.startsWith('failed:')) ?? ''
  assert.doesNotMatch(msg, /signed out/i); assert.match(msg, /unexpected redirect at \/maintenance/)
})
test('401 is an established auth failure; 500 and other statuses are not', async () => {
  const { isAuthFailure } = await import('./syncRunner')
  assert.equal(isAuthFailure({ status: 401 }), true)
  assert.equal(isAuthFailure({ status: 405 }), false)
  assert.equal(isAuthFailure({ status: 500 }), false)
  assert.equal(isAuthFailure({ status: 200, redirected: true, url: 'https://x/login' }), true)
  assert.equal(isAuthFailure({ status: 200, redirected: true, url: 'https://x/loginfoo' }), false)
})
test('an unexplained 405 halts the pass after one request (source pin) and is retried by the normal timer', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync('src/lib/db/syncRunner.ts', 'utf8')
  assert.match(src, /new UploadFailure\(describeUnexpectedTransport\(res\), 'server', false, true\)/)
  assert.match(src, /if \(failure\.haltPass\) \{ connectivityLost = true; break \}/)
})
test('a genuine 422 refusal is still kept as rejected with its reason', async () => {
  const { run, calls } = runnerWith({ ok: false, status: 422, body: { error: 'Scorecard not active' } })
  await run(); assert.ok(calls.includes('rejected'))
})
test('old "HTTP 405" rejections are recoverable; other rejections and conflicts are not touched', () => {
  assert.equal(isTransportRejection(entry({ syncStatus: 'rejected', lastError: 'HTTP 405' })), true)
  assert.equal(isTransportRejection(entry({ syncStatus: 'rejected', lastError: 'Scorecard not active' })), false)
  assert.equal(isTransportRejection(entry({ syncStatus: 'rejected', lastError: 'HTTP 405', conflict: { serverGross: 5, serverNoReturn: false, serverEnteredAt: null } as never })), false)
  assert.equal(isTransportRejection(entry({ syncStatus: 'synced', lastError: 'HTTP 405' })), false)
})
test('middleware answers a signed-out API call with JSON 401 (no redirect); pages still redirect to /login', () => {
  assert.match(mw, /pathname\.startsWith\('\/api\/'\)\) \{\s*return NextResponse\.json\(\{ error: 'Not authenticated' \}, \{ status: 401 \}\)/)
  assert.match(mw, /url\.pathname = '\/login'/)
})

import { planTransportRequeue } from './queueRules'
import { decideScoreWrite } from '../scoring/scoreWriteDecision'

test('34 queued scores while signed out or on an unexplained 405: ONE request per pass, nothing rejected, queue size unchanged', async () => {
  const rows = Array.from({ length: 34 }, (_, i) => entry({ clientId: `c${i}`, holeId: `h${i}` }))
  let fetches = 0; const errors: string[] = []; const rejected: string[] = []
  const deps = {
    getPendingEntries: async () => rows.filter(r => !errors.includes(r.clientId)),
    recoverInterrupted: async () => 0, markSyncing: async () => {}, markSynced: async () => {},
    markError: async (id: string) => { errors.push(id) }, markRejected: async (id: string) => { rejected.push(id) }, markConflict: async () => {},
    getPendingCount: async () => rows.length, getRejectedCount: async () => 0,
    fetchFn: async () => { fetches++; return { ok: false, status: 405, redirected: true, json: async () => ({}), headers: new Headers(), text: async () => '' } },
    report: { syncing() {}, pendingCount() {}, rejectedCount() {}, complete() {}, failed() {} },
  } as unknown as SyncDeps
  await createSyncRunner(deps)()
  assert.equal(fetches, 1, 'one probe, not 34 requests'); assert.equal(rejected.length, 0); assert.equal(rows.length, 34, 'no rows added')
})

test('recovery re-queues only the NEWEST row per hole; a superseded old row is left alone', () => {
  const old = entry({ clientId: 'old', syncStatus: 'rejected', lastError: 'HTTP 405', grossScore: 4, enteredAt: '2026-10-26T01:00:00.000Z' })
  const newer = entry({ clientId: 'new', syncStatus: 'synced', grossScore: 5, enteredAt: '2026-10-26T01:05:00.000Z' })
  assert.deepEqual(planTransportRequeue([old, newer]), [], 'a newer accepted row exists: nothing to resurrect')
  assert.deepEqual(planTransportRequeue([old]), ['old'])
  const otherHole = entry({ clientId: 'x', holeId: 'h2', syncStatus: 'rejected', lastError: 'HTTP 405' })
  assert.deepEqual(planTransportRequeue([old, newer, otherHole]).sort(), ['x'])
  assert.deepEqual(planTransportRequeue([entry({ clientId: 'r', syncStatus: 'rejected', lastError: 'Scorecard not active' })]), [], 'real refusals never auto-retried')
})

test('server side: an old recovered score can never overwrite a newer accepted one', () => {
  const server = { id: 'row', client_id: 'new', entered_at: '2026-10-26T01:05:00.000Z', gross_score: 5, is_no_return: false }
  const resend = { client_id: 'old', entered_at: '2026-10-26T01:00:00.000Z', gross_score: 4, is_no_return: false }
  assert.equal(decideScoreWrite(server, resend).action, 'stale')
  assert.equal(decideScoreWrite({ ...server, admin_overridden: true }, { ...resend, entered_at: '2026-10-26T02:00:00.000Z' }).action, 'locked', 'organiser lock still wins')
})
