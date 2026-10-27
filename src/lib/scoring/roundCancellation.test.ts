import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  canCancelRound, canReinstateRound, isEventComplete, countedRounds, describeCancelImpact, normaliseCancelReason, CANCEL_REASON_MAX,
} from './roundLifecycle'
import { cancelRound, reinstateRound } from './roundCancellation'
import { deriveEventProgress } from './roundWorkflow'
import { selectLeaderboardRound, resolveRequestedOrDefaultRound, selectRelevantSideGameRounds } from './multiRound'

// ── pure rules ────────────────────────────────────────────────────────────
test('only an upcoming round can be cancelled; only a cancelled round can be reinstated', () => {
  assert.equal(canCancelRound('upcoming'), true)
  for (const s of ['active', 'completed', 'cancelled', 'bogus']) assert.equal(canCancelRound(s), false, s)
  assert.equal(canReinstateRound('cancelled'), true)
  for (const s of ['upcoming', 'active', 'completed']) assert.equal(canReinstateRound(s), false, s)
})

test('isEventComplete: Lappen (completed + cancelled) is complete; unfinished and empty events are not', () => {
  assert.equal(isEventComplete([{ status: 'completed' }, { status: 'cancelled' }]), true)
  assert.equal(isEventComplete([{ status: 'completed' }, { status: 'completed' }]), true)
  assert.equal(isEventComplete([{ status: 'completed' }]), true)
  assert.equal(isEventComplete([{ status: 'completed' }, { status: 'upcoming' }]), false)
  assert.equal(isEventComplete([{ status: 'completed' }, { status: 'active' }]), false)
  assert.equal(isEventComplete([{ status: 'cancelled' }, { status: 'cancelled' }]), false)
  assert.equal(isEventComplete([{ status: 'cancelled' }]), false)
  assert.equal(isEventComplete([]), false)
  assert.equal(isEventComplete([{ status: 'upcoming' }]), false)
})

test('countedRounds drops cancelled rounds only', () => {
  const r = [{ id: 'a', status: 'completed' }, { id: 'b', status: 'cancelled' }, { id: 'c', status: 'upcoming' }]
  assert.deepEqual(countedRounds(r).map(x => x.id), ['a', 'c'])
})

test('describeCancelImpact reports whether any playable round remains, and the no-completed-round case', () => {
  const lappen = [{ id: 'r1', status: 'completed' }, { id: 'r2', status: 'upcoming' }]
  assert.deepEqual(describeCancelImpact(lappen, 'r2'), { remainingRounds: 1, completedRounds: 1, noPlayableRoundsRemain: true, noCompletedRounds: false })
  const three = [{ id: 'r1', status: 'completed' }, { id: 'r2', status: 'upcoming' }, { id: 'r3', status: 'upcoming' }]
  assert.equal(describeCancelImpact(three, 'r2').noPlayableRoundsRemain, false)
  const none = [{ id: 'r1', status: 'upcoming' }, { id: 'r2', status: 'upcoming' }]
  const i = describeCancelImpact(none, 'r2'); assert.equal(i.noCompletedRounds, true); assert.equal(i.noPlayableRoundsRemain, false)
})

test('normaliseCancelReason trims, collapses whitespace, caps length, and nulls empties', () => {
  assert.equal(normaliseCancelReason('  Heavy   rain \n today '), 'Heavy rain today')
  assert.equal(normaliseCancelReason('   '), null)
  assert.equal(normaliseCancelReason(undefined), null)
  assert.equal(normaliseCancelReason(42), null)
  assert.equal(normaliseCancelReason('x'.repeat(500))!.length, CANCEL_REASON_MAX)
})

// ── event progress (My HQ) ────────────────────────────────────────────────
test('deriveEventProgress ignores cancelled rounds: Lappen reads 1 of 1 and all rounds closed', () => {
  const p = deriveEventProgress({ rounds: [{ status: 'completed' }, { status: 'cancelled' }] })
  assert.deepEqual(p, { closedCount: 1, totalCount: 1, allRoundsClosed: true })
  assert.equal(deriveEventProgress({ rounds: [{ status: 'cancelled' }] }).allRoundsClosed, false)
  assert.equal(deriveEventProgress({ rounds: [{ status: 'completed' }, { status: 'upcoming' }] }).allRoundsClosed, false)
  assert.deepEqual(deriveEventProgress({ rounds: [{ status: 'completed' }, { status: 'completed' }] }), { closedCount: 2, totalCount: 2, allRoundsClosed: true })
})

// ── selection helpers never surface a cancelled round ────────────────────
const D = (id: string, status: string, d: string) => ({ id, status, play_date: d, created_at: `${d}T00:00:00Z`, name: id })
test('leaderboard selection never lands on a cancelled round', () => {
  const rounds = [D('r1', 'completed', '2026-10-24'), D('r2', 'cancelled', '2026-10-25')]
  assert.equal(selectLeaderboardRound(rounds)?.id, 'r1')
  assert.equal(resolveRequestedOrDefaultRound(rounds, undefined)?.id, 'r1')
  assert.equal(selectLeaderboardRound([D('x', 'cancelled', '2026-10-24'), D('y', 'upcoming', '2026-10-25')])?.id, 'y')
  assert.equal(selectLeaderboardRound([D('x', 'cancelled', '2026-10-24')]), undefined)
  assert.deepEqual(selectRelevantSideGameRounds(rounds).map(r => r.id), ['r1'])
})

// ── in-memory store for the route logic ──────────────────────────────────
type Row = Record<string, unknown>
class Mem {
  tables: Record<string, Row[]> = { trips: [], rounds: [], round_status_events: [], shared_presentations: [], scorecards: [], score_entries: [] }
  failTable: string | null = null
  from(t: string) { return new Q(this, t) }
}
class Q {
  private f: Array<(r: Row) => boolean> = []
  private op: 'select' | 'insert' | 'update' = 'select'
  private payload: Row = {}
  constructor(private db: Mem, private t: string) {}
  select() { return this }
  eq(c: string, v: unknown) { this.f.push(r => r[c] === v); return this }
  insert(p: Row) { this.op = 'insert'; this.payload = p; return this }
  update(p: Row) { this.op = 'update'; this.payload = p; return this }
  maybeSingle() { return this.run(true) }
  then<A, B = never>(a?: ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null, b?: ((e: unknown) => B | PromiseLike<B>) | null) { return this.run(false).then(a, b) }
  private async run(single: boolean): Promise<{ data: unknown; error: { code: string } | null }> {
    if (this.db.failTable === this.t && this.op !== 'select') return { data: null, error: { code: 'XX000' } }
    const rows = this.db.tables[this.t]
    if (this.op === 'insert') { rows.push({ ...this.payload }); return { data: null, error: null } }
    const hit = rows.filter(r => this.f.every(fn => fn(r)))
    if (this.op === 'update') { for (const r of hit) Object.assign(r, this.payload); return { data: hit, error: null } }
    return { data: single ? (hit[0] ?? null) : hit, error: null }
  }
}
const quiet = async <T>(fn: () => Promise<T>): Promise<T> => { const e = console.error; console.error = () => {}; try { return await fn() } finally { console.error = e } }
function lappen(): Mem {
  const m = new Mem()
  m.tables.trips.push({ id: 't1', status: 'live', is_practice: false })
  m.tables.rounds.push({ id: 'r1', trip_id: 't1', name: 'Round 1', status: 'completed' })
  m.tables.rounds.push({ id: 'r2', trip_id: 't1', name: 'Round 2', status: 'upcoming' })
  m.tables.scorecards.push({ id: 's1', round_id: 'r1', status: 'completed' })
  m.tables.score_entries.push({ id: 'e1', scorecard_id: 's1', gross_score: 4 })
  return m
}
const status = (m: Mem, id: string) => m.tables.rounds.find(r => r.id === id)!.status

test('Lappen: cancelling the unplayed round does NOT finish the event or crown anyone, and preserves Round 1 untouched', async () => {
  const m = lappen()
  const before = JSON.stringify([m.tables.scorecards, m.tables.score_entries, m.tables.rounds[0]])
  const r = await cancelRound(m, { tripId: 't1', roundId: 'r2', userId: 'org', reason: '  Heavy rain ' })
  assert.equal(r.status, 200); assert.equal(r.body.eventCompleted, false); assert.equal(r.body.noPlayableRoundsRemain, true)
  assert.equal(status(m, 'r2'), 'cancelled'); assert.equal(status(m, 'r1'), 'completed')
  assert.equal(m.tables.trips[0].status, 'live', 'ending the event is a separate organiser decision')
  const r2 = m.tables.rounds[1]
  assert.equal(r2.cancel_reason, 'Heavy rain'); assert.equal(r2.cancelled_by, 'org'); assert.ok(r2.cancelled_at)
  assert.equal(JSON.stringify([m.tables.scorecards, m.tables.score_entries, m.tables.rounds[0]]), before, 'no scores or Round 1 data changed')
  assert.equal(m.tables.scorecards.length, 1, 'no scorecards fabricated for the cancelled round')
  assert.deepEqual(m.tables.round_status_events.map(e => [e.action, e.round_id, e.actor_id, e.reason]), [['cancelled', 'r2', 'org', 'Heavy rain']])
})

test('preview writes nothing', async () => {
  const m = lappen()
  const r = await cancelRound(m, { tripId: 't1', roundId: 'r2', userId: 'org', preview: true })
  assert.equal(r.status, 200); assert.equal(r.body.preview, true)
  assert.equal(status(m, 'r2'), 'upcoming'); assert.equal(m.tables.trips[0].status, 'live'); assert.equal(m.tables.round_status_events.length, 0)
})

test('cancel refuses completed, active, already-cancelled, unknown, and practice', async () => {
  const m = lappen()
  assert.equal((await cancelRound(m, { tripId: 't1', roundId: 'r1', userId: 'o' })).status, 409)
  m.tables.rounds.push({ id: 'ra', trip_id: 't1', name: 'Live', status: 'active' })
  assert.equal((await cancelRound(m, { tripId: 't1', roundId: 'ra', userId: 'o' })).status, 409)
  assert.equal(status(m, 'ra'), 'active')
  assert.equal((await cancelRound(m, { tripId: 't1', roundId: 'nope', userId: 'o' })).status, 404)
  assert.equal((await cancelRound(m, { tripId: 'other', roundId: 'r2', userId: 'o' })).status, 404)
  m.tables.trips.push({ id: 'p1', status: 'live', is_practice: true }); m.tables.rounds.push({ id: 'pr', trip_id: 'p1', name: 'P', status: 'upcoming' })
  assert.equal((await cancelRound(m, { tripId: 'p1', roundId: 'pr', userId: 'o' })).status, 409)
  m.tables.rounds.push({ id: 'rc', trip_id: 't1', name: 'C', status: 'cancelled' })
  assert.equal((await cancelRound(m, { tripId: 't1', roundId: 'rc', userId: 'o' })).status, 409)
})

test('cancelling unplayed rounds never changes the event status; only noPlayableRoundsRemain flips', async () => {
  const m = lappen(); m.tables.rounds.push({ id: 'r3', trip_id: 't1', name: 'Round 3', status: 'upcoming' })
  const r = await cancelRound(m, { tripId: 't1', roundId: 'r2', userId: 'o' })
  assert.equal(r.body.eventCompleted, false); assert.equal(r.body.noPlayableRoundsRemain, false); assert.equal(m.tables.trips[0].status, 'live')
  const r3 = await cancelRound(m, { tripId: 't1', roundId: 'r3', userId: 'o' })
  assert.equal(r3.body.eventCompleted, false); assert.equal(r3.body.noPlayableRoundsRemain, true); assert.equal(m.tables.trips[0].status, 'live')
})

test('cancelling the only round, or every round, never completes the event', async () => {
  const m = new Mem(); m.tables.trips.push({ id: 't', status: 'live', is_practice: false })
  m.tables.rounds.push({ id: 'a', trip_id: 't', name: 'A', status: 'upcoming' }, { id: 'b', trip_id: 't', name: 'B', status: 'upcoming' })
  await cancelRound(m, { tripId: 't', roundId: 'a', userId: 'o' }); await cancelRound(m, { tripId: 't', roundId: 'b', userId: 'o' })
  assert.equal(m.tables.trips[0].status, 'live')
})

test('reinstate restores upcoming, reopens a completed event, clears cancel fields and audits', async () => {
  const m = lappen(); m.tables.shared_presentations.push({ id: 'sp', trip_id: 't1', status: 'active' })
  await cancelRound(m, { tripId: 't1', roundId: 'r2', userId: 'org', reason: 'Rain' })
  m.tables.trips[0].status = 'completed' // the organiser ended the event after the cancellation
  const r = await reinstateRound(m, { tripId: 't1', roundId: 'r2', userId: 'org' })
  assert.equal(r.status, 200); assert.equal(r.body.eventReopened, true); assert.equal(r.body.presentationPublished, true)
  assert.equal(status(m, 'r2'), 'upcoming'); assert.equal(m.tables.trips[0].status, 'live')
  const row = m.tables.rounds[1]; assert.equal(row.cancel_reason, null); assert.equal(row.cancelled_at, null); assert.equal(row.cancelled_by, null)
  assert.deepEqual(m.tables.round_status_events.map(e => e.action), ['cancelled', 'reinstated'])
  assert.equal((await reinstateRound(m, { tripId: 't1', roundId: 'r2', userId: 'org' })).status, 409)
  assert.equal((await reinstateRound(m, { tripId: 't1', roundId: 'r1', userId: 'org' })).status, 409)
})

test('a failed update surfaces an error and leaves the round and event untouched', async () => {
  const m = lappen(); m.failTable = 'rounds'
  const r = await quiet(() => cancelRound(m, { tripId: 't1', roundId: 'r2', userId: 'o' }))
  assert.equal(r.status, 500); assert.equal(status(m, 'r2'), 'upcoming'); assert.equal(m.tables.trips[0].status, 'live')
})

test('an audit-table failure does not block the cancellation (columns on the round still record it)', async () => {
  const m = lappen(); m.failTable = 'round_status_events'
  const r = await quiet(() => cancelRound(m, { tripId: 't1', roundId: 'r2', userId: 'o', reason: 'Rain' }))
  assert.equal(r.status, 200); assert.equal(status(m, 'r2'), 'cancelled'); assert.equal(m.tables.rounds[1].cancel_reason, 'Rain')
})

test('a round started in another tab is never cancelled (conditional update)', async () => {
  const m = lappen()
  const real = m.from.bind(m)
  // simulate the round flipping to active between the read and the write
  m.from = (t: string) => { const q = real(t); if (t === 'rounds') { const u = q.update.bind(q); q.update = (p: Row) => { m.tables.rounds[1].status = 'active'; return u(p) } } return q }
  const r = await cancelRound(m, { tripId: 't1', roundId: 'r2', userId: 'o' })
  assert.equal(r.status, 409); assert.equal(status(m, 'r2'), 'active'); assert.equal(m.tables.round_status_events.length, 0)
})

// ── wiring (source) ───────────────────────────────────────────────────────
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
test('close-round auto-completes only a normal completion (no cancelled round)', () => {
  const s = read('src/app/api/trips/[tripId]/rounds/[roundId]/close/route.ts')
  assert.match(s, /shouldAutoCompleteEvent\(\(allRoundsRes\.data \?\? \[\]\) as \{ status: string \}\[\]\)/)
})
test('cancel and reinstate routes are organiser-only and use the shared logic', () => {
  for (const [dir, fn] of [['cancel', 'cancelRound'], ['reinstate', 'reinstateRound']] as const) {
    const s = read(`src/app/api/trips/[tripId]/rounds/[roundId]/${dir}/route.ts`)
    assert.match(s, /role !== 'organiser'/); assert.match(s, /403/); assert.match(s, new RegExp(`await ${fn}\\(admin`))
  }
})
test('start and release routes refuse a cancelled round', () => {
  assert.match(read('src/app/api/trips/[tripId]/rounds/[roundId]/start/route.ts'), /round\.status === 'cancelled'/)
  assert.match(read('src/app/api/trips/[tripId]/rounds/[roundId]/release/route.ts'), /status === 'cancelled'/)
})
test('presentation manifest excludes cancelled rounds at the source', () => {
  // 27 Oct: numbered over ALL rounds first (cancelled keep their number), THEN dropped from the manifest.
  const src = read('src/lib/trips/eventMemoryData.ts')
  assert.match(src, /numberRounds\(allRoundRows\)/)
  assert.match(src, /filter\(r => r\.status !== 'cancelled'\)/)
})
test('migration 097 is additive and documents its rollback', () => {
  const s = read('supabase/migrations/097_round_cancellation.sql')
  assert.match(s, /CHECK \(status IN \('upcoming','active','completed','cancelled'\)\)/)
  assert.match(s, /ROLLBACK/); assert.match(s, /ENABLE ROW LEVEL SECURITY/)
  assert.doesNotMatch(s, /DROP TABLE(?! IF EXISTS public\.round_status_events)|DELETE FROM|TRUNCATE/)
})
