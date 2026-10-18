import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OfflineScoreEntry } from '../../types/app'
import { decideScoreWrite, type ExistingScoreRow } from './scoreWriteDecision'
import { validateScoreAck, type AckResponseLike } from '../db/scoreAck'
import { planQueueWrite, isInterruptedSyncing, planConflictResolution, isConflictEntry } from '../db/queueRules'
import { createSyncRunner, type SyncDeps } from '../db/syncRunner'
import { deriveSyncStatus, canConfirmRound } from '../db/syncStatus'

/**
 * Follow-up to Phase B (16 Oct): (1) an organiser-overridden score is
 * locked against every normal scoring submission, and (2) a score that
 * disagrees with a newer server value is never silently marked synced -
 * it is kept for an explicit, authorised decision.
 *
 * Same limits as offlineScoringPhaseB.test.ts: the route, Dexie and React
 * glue cannot run in the sandbox. The DECISIONS (decideScoreWrite, the
 * ack validator, the sync runner, the conflict planner) are the real code,
 * run against an in-memory queue and an in-memory model of the route.
 */

const SC = 'card-1'
const H = (n: number) => `hole-${n}`

class FakeQueue {
  rows = new Map<string, OfflineScoreEntry>()
  clock: number
  private seq = 0
  constructor(public name: string, startIso = '2026-10-17T01:00:00.000Z') { this.clock = Date.parse(startIso) }
  tick(ms = 1000) { this.clock += ms; return new Date(this.clock).toISOString() }

  queue(hole: number, gross: number | null, opts: { role?: 'self' | 'marker'; scorecardId?: string } = {}): string {
    const role = opts.role ?? 'self'
    const scorecardId = opts.scorecardId ?? SC
    const rowsForKey = [...this.rows.values()].filter(r => r.scorecardId === scorecardId && r.holeId === H(hole) && r.captureRole === role)
    const plan = planQueueWrite(rowsForKey, {
      scorecardId, holeId: H(hole), captureRole: role, grossScore: gross, isNoReturn: false, enteredAt: this.tick(),
    }, this.clock, () => `${this.name}-${++this.seq}`)
    if (plan.action === 'noop') return plan.clientId
    this.rows.set(plan.row.clientId, plan.row)
    for (const id of plan.deleteClientIds) if (id !== plan.row.clientId) this.rows.delete(id)
    return plan.row.clientId
  }
  count(status: string) { return [...this.rows.values()].filter(r => r.syncStatus === status).length }
  get(id: string) { return this.rows.get(id)! }

  /** Mirrors dexie.resolveConflictEntry. */
  resolve(id: string, action: 'accept_server' | 'replace_with_mine', isOrganiser: boolean): string | null {
    const plan = planConflictResolution(this.rows.get(id), action, isOrganiser, this.clock)
    if (!plan.ok) return plan.reason
    Object.assign(this.rows.get(id)!, plan.patch)
    return null
  }

  deps(fetchFn: SyncDeps['fetchFn']): SyncDeps {
    return {
      getPendingEntries: async () => [...this.rows.values()].filter(r => r.syncStatus === 'pending' || r.syncStatus === 'error').sort((a, b) => Date.parse(a.enteredAt) - Date.parse(b.enteredAt)),
      recoverInterrupted: async () => { let n = 0; for (const r of this.rows.values()) if (isInterruptedSyncing(r, this.clock)) { r.syncStatus = 'pending'; n++ } return n },
      markSyncing: async id => { const r = this.rows.get(id); if (r) { r.syncStatus = 'syncing'; r.syncStartedAt = new Date(this.clock).toISOString(); r.sendAttempts = (r.sendAttempts ?? 0) + 1 } },
      markSynced: async (id, sent) => { const r = this.rows.get(id); if (r && r.grossScore === sent.grossScore && r.isNoReturn === sent.isNoReturn) r.syncStatus = 'synced' },
      markError: async (id, m) => { const r = this.rows.get(id); if (r) { r.syncStatus = 'error'; r.retryCount++; r.lastError = m } },
      markRejected: async (id, m) => { const r = this.rows.get(id); if (r) { r.syncStatus = 'rejected'; r.lastError = m } },
      // mirrors dexie.markEntryConflict (only applies if the row still holds the sent value)
      markConflict: async (id, sent, server) => {
        const r = this.rows.get(id)
        if (r && r.grossScore === sent.grossScore && r.isNoReturn === sent.isNoReturn) {
          r.syncStatus = 'rejected'
          r.conflict = { serverGross: server.grossScore, serverNoReturn: server.isNoReturn, serverEnteredAt: server.enteredAt }
        }
      },
      getPendingCount: async () => [...this.rows.values()].filter(r => ['pending', 'error', 'syncing'].includes(r.syncStatus)).length,
      getRejectedCount: async () => this.count('rejected'),
      report: { syncing() {}, pendingCount() {}, rejectedCount() {}, complete() {}, failed() {} },
      timeoutMs: 40,
      fetchFn,
    }
  }
}

interface ServerRow {
  id: string; scorecard_id: string; hole_id: string; capture_role: string; gross_score: number | null
  is_no_return: boolean; client_id: string; entered_at: string; admin_overridden: boolean
}

/** Model of POST /api/scores' write section; decideScoreWrite is the real one. */
class FakeServer {
  rows = new Map<string, ServerRow>()
  private id = 0
  /** runs after the read/decision and before the UPDATE - simulates a concurrent organiser override */
  beforeUpdate: (() => void) | null = null
  key(hole: number, role = 'self', card = SC) { return `${card}:${H(hole)}:${role}` }
  value(hole: number, role = 'self') { return this.rows.get(this.key(hole, role))?.gross_score }
  row(hole: number, role = 'self') { return this.rows.get(this.key(hole, role))! }

  /** What applyHoleOverride does: value + flag only; entered_at / client_id untouched. */
  organiserOverride(hole: number, gross: number) {
    const r = this.rows.get(this.key(hole))
    if (r) { r.gross_score = gross; r.admin_overridden = true; return }
    this.rows.set(this.key(hole), {
      id: `row-${++this.id}`, scorecard_id: SC, hole_id: H(hole), capture_role: 'self', gross_score: gross, is_no_return: false,
      client_id: `override-${this.id}`, entered_at: new Date().toISOString(), admin_overridden: true,
    })
  }

  handle(body: Record<string, unknown>): { status: number; body: unknown } {
    const key = `${body.scorecard_id}:${body.hole_id}:${body.capture_role}`
    const existing = this.rows.get(key) ?? null
    const incoming = { client_id: body.client_id as string, entered_at: body.entered_at as string, gross_score: body.gross_score as number | null, is_no_return: body.is_no_return as boolean }
    const d = decideScoreWrite(existing as ExistingScoreRow | null, incoming)
    if (d.action === 'duplicate') return { status: 200, body: { ...existing, message: 'Already recorded', conflict: true, duplicate: true } }
    if (d.action === 'stale') return { status: 200, body: { ...existing, message: 'A newer score is already recorded', stale: true } }
    if (d.action === 'locked') return { status: 200, body: { ...existing, message: 'locked', stale: true, locked: true } }
    if (d.action === 'update') {
      this.beforeUpdate?.(); this.beforeUpdate = null
      const cur = this.rows.get(key)!
      // the UPDATE's own guards: entered_at <= incoming AND admin_overridden = false
      if (cur.admin_overridden) return { status: 200, body: { ...cur, message: 'locked', stale: true, locked: true } }
      if (Date.parse(cur.entered_at) > Date.parse(incoming.entered_at)) return { status: 200, body: { ...cur, message: 'A newer score is already recorded', stale: true } }
    }
    const row: ServerRow = {
      id: existing?.id ?? `row-${++this.id}`, scorecard_id: body.scorecard_id as string, hole_id: body.hole_id as string,
      capture_role: body.capture_role as string, gross_score: incoming.gross_score, is_no_return: incoming.is_no_return,
      client_id: incoming.client_id, entered_at: incoming.entered_at, admin_overridden: false,
    }
    this.rows.set(key, row)
    return { status: 201, body: row }
  }
}

function res(status: number, body: unknown, over: { redirected?: boolean; contentType?: string | null } = {}): AckResponseLike {
  const ct = over.contentType === undefined ? 'application/json' : over.contentType
  return { ok: status >= 200 && status < 300, status, redirected: over.redirected ?? false, headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? ct : null) }, json: async () => body }
}
const viaServer = (server: FakeServer): SyncDeps['fetchFn'] => async (_u, init) => { const r = server.handle(JSON.parse(init.body)); return res(r.status, r.body) }
const sync = (q: FakeQueue, s: FakeServer) => createSyncRunner(q.deps(viaServer(s)))()

const exp = { scorecardId: SC, holeId: H(1), captureRole: 'self' as const, grossScore: 4, isNoReturn: false }
const stored = { id: 'r1', scorecard_id: SC, hole_id: H(1), capture_role: 'self', is_no_return: false, entered_at: '2026-10-17T02:00:00.000Z' }

// ═══ PART 1 — organiser override lock ═══════════════════════════════════

test('LOCK: decideScoreWrite locks an overridden row before comparing anything - newer, older, same client_id, same value', () => {
  const row = (over: Partial<ExistingScoreRow> = {}): ExistingScoreRow => ({ id: 'r', client_id: 'c-old', entered_at: '2026-10-17T02:00:00.000Z', gross_score: 5, is_no_return: false, admin_overridden: true, ...over })
  const inc = (over = {}) => ({ client_id: 'c-new', entered_at: '2026-10-17T05:00:00.000Z', gross_score: 4, is_no_return: false, ...over })
  assert.deepEqual(decideScoreWrite(row(), inc()), { action: 'locked', rowId: 'r' }, 'much newer timestamp still locked')
  assert.deepEqual(decideScoreWrite(row(), inc({ entered_at: '2026-10-17T00:00:00.000Z' })), { action: 'locked', rowId: 'r' }, 'older timestamp')
  assert.deepEqual(decideScoreWrite(row(), inc({ client_id: 'c-old', gross_score: 5 })), { action: 'locked', rowId: 'r' }, 'identical resend')
  assert.deepEqual(decideScoreWrite(row({ admin_overridden: false }), inc()), { action: 'update', rowId: 'r' }, 'not overridden: normal update')
  assert.deepEqual(decideScoreWrite(row({ admin_overridden: undefined }), inc()), { action: 'update', rowId: 'r' }, 'flag absent: normal update')
  assert.deepEqual(decideScoreWrite(null, inc()), { action: 'insert' })
})

test('LOCK: a delayed offline score cannot overwrite the organiser\'s verified correction (the reconnect scenario)', async () => {
  const server = new FakeServer(), phone = new FakeQueue('p')
  phone.queue(1, 4)                       // player scores 4 with no signal
  server.organiserOverride(1, 5)          // Darren verifies the paper card: 5
  await sync(phone, server)               // the phone reconnects later
  assert.equal(server.value(1), 5, 'organiser value untouched')
  assert.equal(server.row(1).admin_overridden, true)
  assert.equal(phone.count('pending'), 0, 'nothing left retrying forever')
  assert.equal(phone.count('rejected'), 0, 'a lock is not a conflict to review')
  assert.equal(phone.count('synced'), 1, 'entry retired as superseded')
})

test('LOCK: the same protection holds when the organiser overrode a hole that nobody had scored yet (lost-phone case)', async () => {
  const server = new FakeServer(), phone = new FakeQueue('p')
  server.organiserOverride(7, 6)
  phone.queue(7, 3)
  await sync(phone, server)
  assert.equal(server.value(7), 6)
  assert.equal(phone.count('pending'), 0)
})

test('LOCK: applies to everyone - the decision takes no role, so an organiser\'s own normal-screen write is refused too', () => {
  assert.equal(decideScoreWrite.length, 2, 'decideScoreWrite(existing, incoming) has no user/role input')
  const route = readFileSync(join(process.cwd(), 'src/app/api/scores/route.ts'), 'utf8')
  const lockedBranch = route.slice(route.indexOf("decision.action === 'locked'"), route.indexOf("decision.action === 'locked'") + 400)
  assert.ok(!/isOrganiser/.test(lockedBranch), 'locked branch is not conditional on the organiser flag')
})

test('LOCK race: an override landing between the read and the write still wins (guard is part of the UPDATE)', async () => {
  const server = new FakeServer(), phone = new FakeQueue('p')
  phone.queue(2, 4)
  await sync(phone, server)               // server now holds the player's 4 (not overridden)
  phone.queue(2, 3)                       // player corrects to 3
  server.beforeUpdate = () => server.organiserOverride(2, 5)  // Darren overrides mid-request
  await sync(phone, server)
  assert.equal(server.value(2), 5, 'override survived the in-flight write')
  assert.equal(phone.count('pending'), 0)
  assert.equal(phone.count('rejected'), 0)
})

test('LOCK: only the overridden (self) row is locked - the marker row for the same hole stays independent', async () => {
  const server = new FakeServer(), phone = new FakeQueue('p')
  phone.queue(3, 4, { role: 'marker' })
  server.organiserOverride(3, 5)
  await sync(phone, server)
  assert.equal(server.value(3, 'marker'), 4, 'marker capture still saved')
  assert.equal(server.value(3, 'self'), 5)
})

test('LOCK: non-overridden holes behave exactly as before - first score, correction, and a full round', async () => {
  const server = new FakeServer(), phone = new FakeQueue('p')
  for (let h = 1; h <= 9; h++) phone.queue(h, 4)
  await sync(phone, server)
  phone.queue(5, 6)
  await sync(phone, server)
  assert.equal(server.value(5), 6)
  assert.equal([...Array(9).keys()].filter(i => server.value(i + 1) !== undefined).length, 9)
  assert.equal(phone.count('pending') + phone.count('rejected'), 0)
})

test('LOCK + shared-device: rows the shared-device / paper-entry / override routes write are flagged admin_overridden, so they are locked too', () => {
  const helper = readFileSync(join(process.cwd(), 'src/lib/scoring/applyHoleOverride.ts'), 'utf8')
  assert.equal((helper.match(/admin_overridden: true/g) ?? []).length, 2, 'both the update and the insert path set the flag')
  const shared = readFileSync(join(process.cwd(), 'src/app/api/trips/[tripId]/rounds/[roundId]/shared-device-score/route.ts'), 'utf8')
  assert.match(shared, /applyHoleOverride\(/)
})

test('LOCK ack: the locked answer is superseded (not invalid, not an error) and says why; stale-compat shape kept', async () => {
  const body = { ...stored, gross_score: 5, stale: true, locked: true, message: 'locked' }
  const r = await validateScoreAck(res(200, body), exp)
  assert.deepEqual(r, { kind: 'superseded', locked: true, sameValue: false, server: { grossScore: 5, isNoReturn: false, enteredAt: stored.entered_at } })
  const lockedOnly = await validateScoreAck(res(200, { ...stored, gross_score: 4, locked: true }), exp)
  assert.equal(lockedOnly.kind === 'superseded' && lockedOnly.locked && lockedOnly.sameValue, true)
  assert.equal((await validateScoreAck(res(200, { ...stored, locked: true }), exp)).kind, 'invalid', 'locked answer without the stored value is not trusted')
  assert.equal((await validateScoreAck(res(200, body, { redirected: true }), exp)).kind, 'invalid')
  assert.equal((await validateScoreAck(res(200, body, { contentType: 'text/html' }), exp)).kind, 'invalid')
  assert.equal((await validateScoreAck(res(200, { ...body, hole_id: 'other' }), exp)).kind, 'invalid')
})

test('LOCK wiring: the route reads admin_overridden, answers locked, and guards the UPDATE itself', () => {
  const route = readFileSync(join(process.cwd(), 'src/app/api/scores/route.ts'), 'utf8')
  assert.match(route, /ROW_COLUMNS = '[^']*admin_overridden'/)
  assert.match(route, /decision\.action === 'locked'[\s\S]{0,300}stale: true, locked: true/)
  assert.match(route, /\.lte\('entered_at', incomingEnteredAt\)[\s\S]{0,200}\.eq\('admin_overridden', false\)/)
  assert.match(route, /current\.data\.admin_overridden === true[\s\S]{0,200}locked: true/)
  assert.ok(route.indexOf("decision.action === 'locked'") < route.indexOf('.update(payload)'), 'lock is decided before any write')
})

// ═══ PART 2 — visible conflict review ═══════════════════════════════════

test('CONFLICT: a different newer server value is kept for review - never marked synced, never forced over the server', async () => {
  const server = new FakeServer(), fast = new FakeQueue('fast', '2026-10-18T01:00:00.000Z'), slow = new FakeQueue('slow')
  fast.queue(4, 5); await sync(fast, server)          // a phone with a fast clock wrote 5 (stamped tomorrow)
  const id = slow.queue(4, 4); await sync(slow, server)  // a correct-clock phone then writes 4 -> looks "older"
  assert.equal(server.value(4), 5, 'server value not overwritten')
  const e = slow.get(id)
  assert.equal(e.syncStatus, 'rejected', 'kept, not synced')
  assert.equal(isConflictEntry(e), true)
  assert.deepEqual({ ...e.conflict, serverEnteredAt: 'x' }, { serverGross: 5, serverNoReturn: false, serverEnteredAt: 'x' })
  assert.equal(e.grossScore, 4, 'local score preserved')
  assert.equal(slow.count('pending'), 0, 'not retried forever')
  assert.equal(slow.count('synced'), 0)
})

test('CONFLICT: re-running sync never overwrites and never re-sends a conflicting entry', async () => {
  const server = new FakeServer(), fast = new FakeQueue('fast', '2026-10-18T01:00:00.000Z'), slow = new FakeQueue('slow')
  fast.queue(4, 5); await sync(fast, server)
  slow.queue(4, 4); await sync(slow, server)
  let sent = 0
  const count: SyncDeps['fetchFn'] = async (u, i) => { sent++; return viaServer(server)(u, i) }
  await createSyncRunner(slow.deps(count))(); await createSyncRunner(slow.deps(count))()
  assert.equal(sent, 0)
  assert.equal(server.value(4), 5)
})

test('CONFLICT: identical stored value is not a disagreement - it is simply synced', async () => {
  const server = new FakeServer(), fast = new FakeQueue('fast', '2026-10-18T01:00:00.000Z'), slow = new FakeQueue('slow')
  fast.queue(4, 4); await sync(fast, server)
  const id = slow.queue(4, 4); await sync(slow, server)
  assert.equal(slow.get(id).syncStatus, 'synced')
  assert.equal(slow.count('rejected'), 0)
})

test('CONFLICT: a stale answer for an entry the player has since edited creates no false conflict, and the newer edit lands', async () => {
  const server = new FakeServer(), phone = new FakeQueue('p')
  const e1 = phone.queue(6, 4)
  // request 1 is in flight; the player corrects the score before the answer returns
  const slowFetch: SyncDeps['fetchFn'] = async (u, init) => {
    phone.queue(6, 5)                     // edit while in flight -> new clientId, e1 retired
    return viaServer(server)(u, init)
  }
  await createSyncRunner(phone.deps(slowFetch))()
  assert.equal(phone.rows.has(e1), false)
  await sync(phone, server)
  assert.equal(server.value(6), 5, 'latest intended score wins')
  assert.equal(phone.count('rejected'), 0, 'no conflict raised for the retired request')
})

test('CONFLICT resolve: anyone may accept the server value; the local entry stops being pending/rejected and nothing is sent', async () => {
  const server = new FakeServer(), fast = new FakeQueue('fast', '2026-10-18T01:00:00.000Z'), slow = new FakeQueue('slow')
  fast.queue(4, 5); await sync(fast, server)
  const id = slow.queue(4, 4); await sync(slow, server)
  assert.equal(slow.resolve(id, 'accept_server', false), null, 'a non-organiser can accept the server value')
  assert.equal(slow.get(id).syncStatus, 'synced')
  assert.equal(slow.get(id).conflict, undefined)
  await sync(slow, server)
  assert.equal(server.value(4), 5, 'server value stands')
})

test('CONFLICT resolve: replacing the server value is organiser-only, explicit, and then really lands', async () => {
  const server = new FakeServer(), fast = new FakeQueue('fast', '2026-10-18T01:00:00.000Z'), slow = new FakeQueue('slow')
  fast.queue(4, 5); await sync(fast, server)
  const id = slow.queue(4, 4); await sync(slow, server)
  assert.match(String(slow.resolve(id, 'replace_with_mine', false)), /Only the organiser/, 'a player cannot force it')
  assert.equal(slow.get(id).syncStatus, 'rejected', 'refusal changed nothing')
  assert.equal(slow.resolve(id, 'replace_with_mine', true), null)
  assert.equal(slow.get(id).syncStatus, 'pending')
  assert.ok(Date.parse(slow.get(id).enteredAt) > Date.parse(server.row(4).entered_at), 'timestamp lifted just above the server\'s so it can be accepted')
  await sync(slow, server)
  assert.equal(server.value(4), 4, 'organiser\'s explicit choice applied')
  assert.equal(slow.count('rejected') + slow.count('pending'), 0)
})

test('CONFLICT resolve: even an explicit organiser replace cannot beat an organiser-LOCKED hole', async () => {
  const server = new FakeServer(), fast = new FakeQueue('fast', '2026-10-18T01:00:00.000Z'), slow = new FakeQueue('slow')
  fast.queue(4, 5); await sync(fast, server)
  const id = slow.queue(4, 4); await sync(slow, server)
  slow.resolve(id, 'replace_with_mine', true)
  server.organiserOverride(4, 6)          // hole is then overridden through the audited panel
  await sync(slow, server)
  assert.equal(server.value(4), 6)
  assert.equal(slow.count('pending'), 0)
})

test('CONFLICT resolve: planner refuses anything that is not a conflict (plain refusals, synced, missing)', () => {
  const base: OfflineScoreEntry = { clientId: 'c', scorecardId: SC, holeId: H(1), captureRole: 'self', grossScore: 4, isNoReturn: false, enteredAt: '2026-10-17T01:00:00.000Z', syncStatus: 'rejected', retryCount: 0 }
  assert.equal(planConflictResolution(undefined, 'accept_server', true, 0).ok, false)
  assert.equal(planConflictResolution(base, 'accept_server', true, 0).ok, false, 'plain refusal has no conflict data')
  assert.equal(planConflictResolution({ ...base, syncStatus: 'synced', conflict: { serverGross: 5, serverNoReturn: false, serverEnteredAt: null } }, 'accept_server', true, 0).ok, false)
})

test('CONFLICT gating: a conflict blocks confirming ITS round only, and is reported as needing review', async () => {
  const server = new FakeServer(), fast = new FakeQueue('fast', '2026-10-18T01:00:00.000Z'), slow = new FakeQueue('slow')
  fast.queue(4, 5); await sync(fast, server)
  slow.queue(4, 4); await sync(slow, server)
  const conflicts = [...slow.rows.values()].filter(isConflictEntry)
  assert.equal(canConfirmRound({ allMatched: true, pendingCount: 0, rejectedForThisRound: conflicts.length }), false)
  assert.equal(canConfirmRound({ allMatched: true, pendingCount: 0, rejectedForThisRound: 0 }), true, 'next round unaffected')
  const st = deriveSyncStatus({ online: true, syncState: 'synced', pendingCount: 0, rejectedCount: conflicts.length, lastFailure: null })
  assert.equal(st.kind, 'rejected')
  assert.match(st.label, /needs review/)
  assert.notEqual(st.kind, 'synced')
})

test('CONFLICT wiring: no generic retry, the screen shows the server value, no new delete path, organiser-only replace, both values shown', () => {
  const root = process.cwd()
  const dexie = readFileSync(join(root, 'src/lib/db/dexie.ts'), 'utf8')
  const banner = readFileSync(join(root, 'src/components/scoring/SyncStatusBanner.tsx'), 'utf8')
  const runner = readFileSync(join(root, 'src/lib/db/syncRunner.ts'), 'utf8')
  assert.match(dexie, /requeueRejectedEntry[\s\S]{0,400}if \(e\.conflict\) return false/, 'Try again cannot re-send a conflict')
  assert.match(dexie, /e\.syncStatus === 'rejected' && e\.conflict\)\) latest\.delete/, 'overlay shows the server value, not the conflicting local one')
  assert.equal((dexie.match(/scoreQueue\.delete\(/g) ?? []).length, 2, 'still only the two pre-existing delete sites')
  assert.match(runner, /ack\.kind === 'superseded' && !ack\.locked && !ack\.sameValue[\s\S]{0,200}markConflict/)
  const conflictCard = banner.slice(banner.indexOf('if (e.conflict) {'), banner.indexOf('Refused by the server'))
  assert.ok(conflictCard.length > 200)
  assert.ok(!/requeueRejectedEntry|Try again/.test(conflictCard), 'conflict card has no generic retry')
  assert.match(conflictCard, /On this phone:[\s\S]{0,120}Recorded on the server:/, 'both values shown')
  assert.match(conflictCard, /isOrganiser && replaceId !== e\.clientId/, 'replace button is organiser-only')
  assert.match(conflictCard, /Yes, replace it/, 'replace needs a confirmation')
  assert.match(banner, /resolveConflictEntry\(clientId, action, isOrganiser\)/)
})
