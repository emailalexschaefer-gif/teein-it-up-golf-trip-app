import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { shouldAutoCompleteEvent, noPlayableRoundsRemain, canEndEvent, describeEndImpact } from './roundLifecycle'
import { endEvent } from './eventEnd'
import { cancelRound, reinstateRound } from './roundCancellation'
import { parseOutcome, readEventOutcome, readEventOutcomes, normaliseEndReason, normaliseEndNote, NORMAL_OUTCOME, END_NOTE_MAX } from '@/lib/trips/eventOutcome'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

// ── outcome parsing: tolerant of migration 099 being absent ──────────────
test('outcome: missing columns, null and garbage all read as a normal completion with a champion', () => {
  for (const row of [null, undefined, {}, 'x', 42, { ended_early: null }, { champion_declared: false }]) {
    const o = parseOutcome(row); assert.equal(o.endedEarly, false); assert.equal(o.championDeclared, true, JSON.stringify(row))
  }
  assert.deepEqual(parseOutcome(null), NORMAL_OUTCOME)
})

test('outcome: no champion only when ended early AND champion_declared is explicitly false', () => {
  assert.equal(parseOutcome({ ended_early: true, champion_declared: false }).championDeclared, false)
  assert.equal(parseOutcome({ ended_early: true, champion_declared: true }).championDeclared, true)
  assert.equal(parseOutcome({ ended_early: true }).championDeclared, true)
  assert.equal(parseOutcome({ ended_early: false, champion_declared: false }).championDeclared, true, 'a normal completion can never be no-champion')
  const o = parseOutcome({ ended_early: true, champion_declared: false, ended_early_reason: 'weather', ended_early_note: '  Storm  ' })
  assert.equal(o.reason, 'weather'); assert.equal(o.note, 'Storm')
  assert.equal(parseOutcome({ ended_early: true, ended_early_reason: 'bogus' }).reason, null)
  assert.equal(parseOutcome({ ended_early: false, ended_early_reason: 'weather' }).reason, null)
})

test('outcome reads: a database error (e.g. migration 099 not applied) falls back to normal completion', async () => {
  const failing = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: '42703' } }) }), in: async () => ({ data: null, error: { code: '42703' } }) }) }) }
  assert.deepEqual(await readEventOutcome(failing, 't'), NORMAL_OUTCOME)
  assert.equal((await readEventOutcomes(failing, ['t'])).size, 0)
  const throwing = { from: () => { throw new Error('boom') } }
  assert.deepEqual(await readEventOutcome(throwing, 't'), NORMAL_OUTCOME)
})

test('reason and note normalisation', () => {
  assert.equal(normaliseEndReason('weather'), 'weather'); assert.equal(normaliseEndReason('Weather'), null); assert.equal(normaliseEndReason(undefined), null)
  assert.equal(normaliseEndNote('  a   b '), 'a b'); assert.equal(normaliseEndNote(5), null); assert.equal(normaliseEndNote('x'.repeat(999))!.length, END_NOTE_MAX)
})

// ── lifecycle rules ──────────────────────────────────────────────────────
const S = (...s: string[]) => s.map(status => ({ status }))
test('shouldAutoCompleteEvent: only a fully played event (no cancelled round) finishes by itself', () => {
  assert.equal(shouldAutoCompleteEvent(S('completed', 'completed')), true)
  assert.equal(shouldAutoCompleteEvent(S('completed')), true)
  assert.equal(shouldAutoCompleteEvent(S('completed', 'cancelled')), false, 'Lappen: organiser must decide')
  assert.equal(shouldAutoCompleteEvent(S('completed', 'upcoming')), false)
  assert.equal(shouldAutoCompleteEvent(S('cancelled')), false)
  assert.equal(shouldAutoCompleteEvent([]), false)
})

test('canEndEvent: needs a played round, no live round, not practice, not already ended', () => {
  assert.deepEqual(canEndEvent('live', false, S('completed', 'upcoming')), { ok: true })
  assert.deepEqual(canEndEvent('live', false, S('completed', 'cancelled')), { ok: true })
  for (const [st, pr, r] of [['completed', false, S('completed')], ['live', true, S('completed')], ['live', false, S('completed', 'active')], ['live', false, S('upcoming', 'cancelled')], ['live', false, S()]] as const) {
    assert.equal(canEndEvent(st, pr, [...r]).ok, false, `${st} ${pr} ${JSON.stringify(r)}`)
  }
})

test('describeEndImpact counts played and to-be-cancelled rounds', () => {
  assert.deepEqual(describeEndImpact(S('completed', 'upcoming', 'upcoming', 'cancelled')), { completedRounds: 1, roundsToCancel: 2, noPlayableRoundsRemain: false })
  assert.equal(describeEndImpact(S('completed', 'cancelled')).noPlayableRoundsRemain, true)
  assert.equal(noPlayableRoundsRemain(S('completed', 'upcoming')), false)
})

// ── endEvent against an in-memory store ──────────────────────────────────
type Row = Record<string, unknown>
class Mem {
  tables: Record<string, Row[]> = { trips: [], rounds: [], round_status_events: [], shared_presentations: [], scorecards: [], score_entries: [] }
  missing099 = false
  failRoundUpdate = false
  from(t: string) { return new Q(this, t) }
}
class Q {
  private f: Array<(r: Row) => boolean> = []
  private op: 'select' | 'insert' | 'update' = 'select'
  private payload: Row = {}
  constructor(private db: Mem, private t: string) {}
  select(cols?: string) { if (this.op === 'select') this.cols = cols; return this }
  private cols: string | undefined
  eq(c: string, v: unknown) { this.f.push(r => r[c] === v); return this }
  neq(c: string, v: unknown) { this.f.push(r => r[c] !== v); return this }
  in(c: string, v: unknown[]) { this.f.push(r => v.includes(r[c])); return this }
  insert(p: Row) { this.op = 'insert'; this.payload = p; return this }
  update(p: Row) { this.op = 'update'; this.payload = p; return this }
  maybeSingle() { return this.run(true) }
  then<A, B = never>(a?: ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null, b?: ((e: unknown) => B | PromiseLike<B>) | null) { return this.run(false).then(a, b) }
  private touches099(cols: string[]) { return cols.some(c => ['ended_early', 'champion_declared', 'ended_early_reason', 'ended_early_note', 'ended_early_at', 'ended_early_by'].includes(c)) }
  private async run(single: boolean): Promise<{ data: unknown; error: { code: string; message?: string } | null }> {
    if (this.db.missing099 && this.t === 'trips') {
      const cols = this.op === 'update' ? Object.keys(this.payload) : (this.cols ?? '').split(',').map(s => s.trim())
      if (this.touches099(cols)) return { data: null, error: { code: '42703', message: 'column trips.ended_early does not exist' } }
    }
    if (this.db.failRoundUpdate && this.t === 'rounds' && this.op === 'update') return { data: null, error: { code: 'XX000' } }
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
  m.tables.trips.push({ id: 't1', status: 'live', is_practice: false, ended_early: false, champion_declared: true })
  m.tables.rounds.push({ id: 'r1', trip_id: 't1', name: 'Round 1', status: 'completed' })
  m.tables.rounds.push({ id: 'r2', trip_id: 't1', name: 'Round 2', status: 'upcoming' })
  m.tables.scorecards.push({ id: 's1', round_id: 'r1', status: 'completed' })
  m.tables.score_entries.push({ id: 'e1', scorecard_id: 's1', gross_score: 4 })
  return m
}
const trip = (m: Mem) => m.tables.trips[0]
const snap = (m: Mem) => JSON.stringify([m.tables.scorecards, m.tables.score_entries, m.tables.rounds[0]])

test('Lappen scenario B: cancel Flinders, end event, NO champion -> completed, no champion, scores untouched', async () => {
  const m = lappen(); const before = snap(m)
  const c = await cancelRound(m, { tripId: 't1', roundId: 'r2', userId: 'org', reason: 'Weather' })
  assert.equal(c.body.eventCompleted, false); assert.equal(trip(m).status, 'live')
  const r = await endEvent(m, { tripId: 't1', userId: 'org', reason: 'weather', note: 'Storm front', declareChampion: false })
  assert.equal(r.status, 200); assert.equal(r.body.championDeclared, false)
  assert.equal(trip(m).status, 'completed'); assert.equal(trip(m).ended_early, true); assert.equal(trip(m).champion_declared, false)
  assert.equal(trip(m).ended_early_reason, 'weather'); assert.equal(trip(m).ended_early_note, 'Storm front'); assert.equal(trip(m).ended_early_by, 'org')
  assert.equal(snap(m), before, 'no scores or Round 1 data changed'); assert.equal(m.tables.scorecards.length, 1, 'nothing fabricated for the cancelled round')
})

test('scenario C: same event, declare champion = Yes', async () => {
  const m = lappen()
  const r = await endEvent(m, { tripId: 't1', userId: 'org', reason: 'weather', declareChampion: true })
  assert.equal(r.status, 200); assert.equal(trip(m).champion_declared, true); assert.equal(trip(m).ended_early, true); assert.equal(trip(m).status, 'completed')
})

test('the champion choice is strict: only boolean true crowns; omitted/"true"/1 mean NO', async () => {
  for (const v of [undefined, null, 'true', 'yes', 1, {}]) {
    const m = lappen(); await endEvent(m, { tripId: 't1', userId: 'o', reason: 'other', declareChampion: v })
    assert.equal(trip(m).champion_declared, false, String(v))
  }
})

test('end event cancels every unplayed round once, audits each, and leaves played rounds alone', async () => {
  const m = lappen(); m.tables.rounds.push({ id: 'r3', trip_id: 't1', name: 'Round 3', status: 'upcoming' })
  const r = await endEvent(m, { tripId: 't1', userId: 'org', reason: 'safety' })
  assert.equal(r.body.roundsCancelled, 2)
  assert.deepEqual(m.tables.rounds.map(x => x.status), ['completed', 'cancelled', 'cancelled'])
  assert.deepEqual(m.tables.round_status_events.map(e => [e.action, e.round_id, e.actor_id]), [['cancelled', 'r2', 'org'], ['cancelled', 'r3', 'org']])
})

test('preview writes nothing and reports the impact', async () => {
  const m = lappen(); const t = JSON.stringify(m.tables)
  const r = await endEvent(m, { tripId: 't1', userId: 'o', preview: true })
  assert.equal(r.status, 200); assert.deepEqual(r.body.impact, { completedRounds: 1, roundsToCancel: 1, noPlayableRoundsRemain: false })
  assert.equal(JSON.stringify(m.tables), t)
})

test('a reason is required; refuses active round, no played round, practice, already-ended and unknown event', async () => {
  const m = lappen()
  assert.equal((await endEvent(m, { tripId: 't1', userId: 'o' })).status, 400); assert.equal(trip(m).status, 'live')
  assert.equal((await endEvent(m, { tripId: 'nope', userId: 'o', reason: 'other' })).status, 404)
  m.tables.rounds[1].status = 'active'; assert.equal((await endEvent(m, { tripId: 't1', userId: 'o', reason: 'other' })).status, 409)
  m.tables.rounds[1].status = 'upcoming'; m.tables.rounds[0].status = 'upcoming'; assert.equal((await endEvent(m, { tripId: 't1', userId: 'o', reason: 'other' })).status, 409)
  m.tables.rounds[0].status = 'completed'; trip(m).is_practice = true; assert.equal((await endEvent(m, { tripId: 't1', userId: 'o', reason: 'other' })).status, 409)
  trip(m).is_practice = false; trip(m).status = 'completed'; assert.equal((await endEvent(m, { tripId: 't1', userId: 'o', reason: 'other' })).status, 409)
})

test('migration 099 missing: clear error and NOTHING is written (no rounds cancelled)', async () => {
  const m = lappen(); m.missing099 = true
  const r = await quiet(() => endEvent(m, { tripId: 't1', userId: 'o', reason: 'weather' }))
  assert.equal(r.status, 500); assert.match(String(r.body.error), /migration 099/)
  assert.equal(m.tables.rounds[1].status, 'upcoming'); assert.equal(trip(m).status, 'live'); assert.equal(m.tables.round_status_events.length, 0)
})

test('a failed round update aborts before the event is marked completed', async () => {
  const m = lappen(); m.failRoundUpdate = true
  const r = await quiet(() => endEvent(m, { tripId: 't1', userId: 'o', reason: 'weather' }))
  assert.equal(r.status, 500); assert.equal(trip(m).status, 'live')
})

test('reopening by reinstating a round clears how the event ended; normal events still reopen before 099', async () => {
  const m = lappen(); await endEvent(m, { tripId: 't1', userId: 'o', reason: 'weather', declareChampion: false })
  const r = await reinstateRound(m, { tripId: 't1', roundId: 'r2', userId: 'o' })
  assert.equal(r.body.eventReopened, true)
  assert.equal(trip(m).status, 'live'); assert.equal(trip(m).ended_early, false); assert.equal(trip(m).champion_declared, true); assert.equal(trip(m).ended_early_reason, null)
  const n = lappen(); n.missing099 = true; n.tables.rounds[1].status = 'cancelled'; trip(n).status = 'completed'
  const rr = await quiet(() => reinstateRound(n, { tripId: 't1', roundId: 'r2', userId: 'o' }))
  assert.equal(rr.body.eventReopened, true, 'normal completion reopens without touching the 099 columns'); assert.equal(trip(n).status, 'live')
})

// ── wiring (source) ──────────────────────────────────────────────────────
test('end-event route is organiser-only, never cached and uses the shared logic', () => {
  const s = read('src/app/api/trips/[tripId]/end-event/route.ts')
  assert.match(s, /role !== 'organiser'/); assert.match(s, /'Not authenticated\.' }, 401/); assert.match(s, /'Only the organiser can end the event\.' }, 403/)
  assert.match(s, /endEvent\(/); assert.match(s, /NO_STORE_HEADERS/)
})

test('migration 099 is additive, defaults to a normal completion and documents its rollback', () => {
  const s = read('supabase/migrations/099_event_outcome.sql')
  assert.match(s, /ADD COLUMN IF NOT EXISTS ended_early\s+BOOLEAN\s+NOT NULL DEFAULT false/)
  assert.match(s, /ADD COLUMN IF NOT EXISTS champion_declared\s+BOOLEAN\s+NOT NULL DEFAULT true/)
  assert.doesNotMatch(s.replace(/--.*$/gm, ''), /DROP|DELETE|TRUNCATE|UPDATE\s/i, 'no destructive statements outside comments')
  assert.match(s, /rollback/i)
})

test('End Event UI: champion choice defaults to NO, a reason is required, confirmation says data is preserved', () => {
  const s = read('src/components/scoring/EndEventControl.tsx')
  assert.match(s, /useState\(false\) \/\/ default: NO champion/)
  assert.match(s, /Declare an overall event champion\?/)
  assert.match(s, /disabled=\{busy \|\| !impact \|\| !reason\}/)
  assert.match(s, /Moments/); assert.match(s, /keep all scores/)
  assert.doesNotMatch(s, /Abandon/i, 'no generic abandoned status')
})

test('My HQ shows End Event only before the event has ended, and gates the event presentation on a finished event', () => {
  const s = read('src/components/scoring/MyHQClient.tsx')
  assert.match(s, /!tripCompleted && canEndEvent\('live', false, rounds\)\.ok/)
  assert.match(s, /eventPresentationReady = eventProgress\.allRoundsClosed && \(tripCompleted \|\| !rounds\.some\(r => r\.status === 'cancelled'\)\)/)
  assert.match(s, /View Final Standings/)
})

test('Cancel Round no longer claims it completes the event', () => {
  const s = read('src/components/scoring/CancelRoundControl.tsx')
  assert.doesNotMatch(s, /completesEvent|The event is now complete|will be marked complete/)
  assert.match(s, /does not finish the event or declare a champion/)
})

test('player home and tournament page read the outcome defensively and drop trophy wording without a champion', () => {
  assert.match(read('src/app/(app)/trips/[tripId]/PlayerHomeCard.tsx'), /championDeclared \? '🏆 View Final Results' : 'View Final Standings'/)
  assert.match(read('src/app/(app)/trips/[tripId]/page.tsx'), /readEventOutcome\(db, tripId\)/)
  assert.match(read('src/app/(app)/trips/[tripId]/tournament/page.tsx'), /eventFinished = eventFullyComplete && \(tripCompleted \|\| !hasCancelledRound\)/)
})

test('bottom-sheet dialogs sit above the bottom nav (z-index 100; dialogs 120) and fit the visible screen', () => {
  const nav = Number(/zIndex: (\d+)/.exec(read('src/components/layout/TripBottomNav.tsx'))![1])
  for (const f of ['src/components/scoring/CancelRoundControl.tsx', 'src/components/scoring/EndEventControl.tsx', 'src/components/leaderboard/ShareLeaderboardPanel.tsx', 'src/components/memories/SharePresentationPanel.tsx']) {
    const s = read(f)
    const z = Number(/role="dialog"[^\n]*zIndex: (\d+)/.exec(s)![1])
    assert.ok(z > nav, `${f}: dialog z-index ${z} must exceed the nav's ${nav}`)
    if (!f.includes('SharePresentation')) { assert.match(s, /maxHeight: '88dvh'/, f); assert.match(s, /safe-area-inset-bottom/, f) }
  }
})

test('organiser dialogs sit above the bottom tab bar (z-index 100; dialogs 120) and keep their buttons reachable', () => {
  for (const f of ['src/components/scoring/CancelRoundControl.tsx', 'src/components/scoring/EndEventControl.tsx']) {
    const s = read(f)
    assert.match(s, /role="dialog"[^>]*style=\{\{ position: 'fixed', inset: 0, zIndex: 120/, f)
    assert.match(s, /maxHeight: '88dvh'/, f); assert.match(s, /position: 'sticky', bottom: -1/, f); assert.match(s, /env\(safe-area-inset-bottom\)/, f)
  }
  assert.match(read('src/components/layout/TripBottomNav.tsx'), /zIndex: 100/)
})
