import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enableSharing, revokeSharing, resolveToken, getActiveLink, buildBoardForTrip, leaderboardPath } from './service'
import { computeRoundLeaderboard } from '@/lib/scoring/roundLeaderboard'

type Row = Record<string, unknown>

/** Minimal in-memory Supabase-like store (select/insert/update, eq/neq/in filters, unique partial index). */
class Mem {
  tables: Record<string, Row[]> = { shared_leaderboards: [], trips: [], rounds: [], holes: [], scorecards: [] }
  private n = 1
  from(t: string) { return new Q(this, t) }
  id() { return `id-${this.n++}` }
}
class Q {
  private f: Array<(r: Row) => boolean> = []
  private op: 'select' | 'insert' | 'update' = 'select'
  private payload: Row = {}
  constructor(private db: Mem, private t: string) {}
  select() { return this }
  eq(c: string, v: unknown) { this.f.push(r => r[c] === v); return this }
  neq(c: string, v: unknown) { this.f.push(r => r[c] !== v); return this }
  in(c: string, vs: unknown[]) { this.f.push(r => vs.includes(r[c])); return this }
  insert(p: Row) { this.op = 'insert'; this.payload = p; return this }
  update(p: Row) { this.op = 'update'; this.payload = p; return this }
  maybeSingle() { return this.run(true) }
  then<A, B = never>(a?: ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null, b?: ((e: unknown) => B | PromiseLike<B>) | null) { return this.run(false).then(a, b) }
  private async run(single: boolean): Promise<{ data: unknown; error: { code?: string } | null }> {
    const rows = this.db.tables[this.t]
    if (this.op === 'insert') {
      const row = { id: this.db.id(), revoked_at: null, ...this.payload }
      if (this.t === 'shared_leaderboards') {
        if (rows.some(r => r.token === row.token)) return { data: null, error: { code: '23505' } }
        if (row.status === 'active' && rows.some(r => r.trip_id === row.trip_id && r.status === 'active')) return { data: null, error: { code: '23505' } }
      }
      rows.push(row)
      return { data: single ? row : [row], error: null }
    }
    const hit = rows.filter(r => this.f.every(fn => fn(r)))
    if (this.op === 'update') { for (const r of hit) Object.assign(r, this.payload); return { data: hit, error: null } }
    return { data: single ? (hit[0] ?? null) : hit, error: null }
  }
}
const asAdmin = (m: Mem) => m as unknown as Parameters<typeof enableSharing>[0]
const quiet = async <T>(fn: () => Promise<T>): Promise<T> => { const e = console.error; console.error = () => {}; try { return await fn() } finally { console.error = e } }

// ── link management ───────────────────────────────────────────────────────
test('existing events are NOT public: no link row means no token resolves', async () => {
  const m = new Mem()
  assert.equal(await getActiveLink(asAdmin(m), 't1'), null)
  assert.equal(await resolveToken(asAdmin(m), 'a'.repeat(43)), null)
})

test('enable creates one 43-char token; enabling again returns the same link (idempotent)', async () => {
  const m = new Mem()
  const a = await enableSharing(asAdmin(m), { tripId: 't1', userId: 'org' })
  assert.ok(a); assert.equal(a!.created, true); assert.equal(a!.token.length, 43); assert.match(a!.token, /^[A-Za-z0-9_-]{43}$/)
  const b = await enableSharing(asAdmin(m), { tripId: 't1', userId: 'org' })
  assert.deepEqual(b, { token: a!.token, created: false })
  assert.equal(m.tables.shared_leaderboards.length, 1)
  assert.equal(m.tables.shared_leaderboards[0].created_by, 'org')
  assert.equal(await resolveToken(asAdmin(m), a!.token), 't1')
  assert.equal(leaderboardPath(a!.token), `/l/${a!.token}`)
})

test('concurrent enables converge on one active link', async () => {
  const m = new Mem()
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => enableSharing(asAdmin(m), { tripId: 't1', userId: 'org' })))
  assert.ok(rs.every(r => r !== null))
  assert.equal(new Set(rs.map(r => r!.token)).size, 1)
  assert.equal(m.tables.shared_leaderboards.filter(r => r.status === 'active').length, 1)
})

test('revoke kills the link at once; the old token never comes back; re-enabling makes a NEW token', async () => {
  const m = new Mem()
  const a = (await enableSharing(asAdmin(m), { tripId: 't1', userId: 'org' }))!
  assert.equal(await revokeSharing(asAdmin(m), { tripId: 't1', userId: 'org' }), true)
  assert.equal(await resolveToken(asAdmin(m), a.token), null)
  assert.equal(m.tables.shared_leaderboards[0].status, 'revoked'); assert.equal(m.tables.shared_leaderboards[0].revoked_by, 'org')
  assert.ok(m.tables.shared_leaderboards[0].revoked_at)
  const b = (await enableSharing(asAdmin(m), { tripId: 't1', userId: 'org' }))!
  assert.notEqual(b.token, a.token); assert.equal(b.created, true)
  assert.equal(await resolveToken(asAdmin(m), a.token), null)
  assert.equal(await resolveToken(asAdmin(m), b.token), 't1')
  assert.equal(await revokeSharing(asAdmin(m), { tripId: 'other', userId: 'org' }), true) // nothing to revoke is not an error
})

test('revoking one event never affects another', async () => {
  const m = new Mem()
  const a = (await enableSharing(asAdmin(m), { tripId: 't1', userId: 'org' }))!
  const b = (await enableSharing(asAdmin(m), { tripId: 't2', userId: 'org2' }))!
  await revokeSharing(asAdmin(m), { tripId: 't1', userId: 'org' })
  assert.equal(await resolveToken(asAdmin(m), a.token), null)
  assert.equal(await resolveToken(asAdmin(m), b.token), 't2')
})

test('malformed tokens are rejected before any database read', async () => {
  const m = new Mem()
  let reads = 0
  const real = m.from.bind(m); m.from = (t: string) => { reads++; return real(t) }
  for (const bad of ['', 'short', 'a'.repeat(42), 'a'.repeat(44), 'a'.repeat(42) + '!', '../etc/passwd', 'a b'.repeat(15)]) assert.equal(await resolveToken(asAdmin(m), bad), null, bad)
  assert.equal(reads, 0)
})

test('a database failure on enable returns null (route answers 500), and on revoke returns false', async () => {
  const m = new Mem()
  const real = m.from.bind(m)
  m.from = (t: string) => { const q = real(t); return new Proxy(q, { get(tg, p, r) { if (p === 'insert' || p === 'update') return () => { const x = tg as unknown as { run: unknown }; void x; const f: Q = tg; return Object.assign(Object.create(f), { then: (a: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: 'XX000' } }).then(a) }) }; return Reflect.get(tg, p, r) } }) }
  assert.equal(await quiet(() => enableSharing(asAdmin(m), { tripId: 't1', userId: 'org' })), null)
  assert.equal(await quiet(() => revokeSharing(asAdmin(m), { tripId: 't1', userId: 'org' })), false)
})

// ── board building from the canonical computation ─────────────────────────
function holes(roundId: string, n = 18) { return Array.from({ length: n }, (_, i) => ({ id: `${roundId}-h${i + 1}`, round_id: roundId, hole_number: i + 1, par: 4, stroke_index: i + 1 })) }
function card(roundId: string, player: string, name: string, pts: number[], status = 'in_progress') {
  return {
    id: `${roundId}-${player}`, round_id: roundId, player_id: player, playing_handicap: 10, status,
    profiles: { full_name: name, avatar_url: null },
    score_entries: pts.map((p, i) => ({ id: `${roundId}-${player}-${i}`, hole_id: `${roundId}-h${i + 1}`, gross_score: 4, stableford_pts: p, is_no_return: false, capture_role: 'self' })),
  }
}
const pts = (total: number, holesPlayed = 18) => Array.from({ length: holesPlayed }, (_, i) => (i < total % holesPlayed || holesPlayed === 0 ? Math.ceil(total / holesPlayed) : Math.floor(total / holesPlayed)))
function seed(m: Mem, tripStatus: string, rounds: { id: string; status: string; date: string }[]) {
  m.tables.trips.push({ id: 't1', name: 'Lappen Invitational', status: tripStatus, is_practice: false })
  for (const r of rounds) {
    m.tables.rounds.push({ id: r.id, trip_id: 't1', name: 'Round', status: r.status, play_date: r.date, created_at: `${r.date}T00:00:00Z`, holes: 18, scoring_format: 'stableford', starting_hole_number: 1 })
    m.tables.holes.push(...holes(r.id))
  }
}

test('before any round starts: NOT STARTED', async () => {
  const m = new Mem(); seed(m, 'active', [{ id: 'r1', status: 'upcoming', date: '2026-10-17' }])
  const b = await buildBoardForTrip(asAdmin(m), 't1')
  assert.equal(b!.status, 'not_started'); assert.equal(b!.rows.length, 0)
})

test('during a round: LIVE, ordered by points then holes, with Thru and full names only', async () => {
  const m = new Mem(); seed(m, 'active', [{ id: 'r1', status: 'active', date: '2026-10-17' }])
  m.tables.scorecards.push(card('r1', 'a', 'Alex Green', pts(20, 9).concat([])), card('r1', 'b', 'Bea Brown', pts(18, 18)), card('r1', 'c', 'Cal White', pts(18, 9)))
  const b = (await buildBoardForTrip(asAdmin(m), 't1'))!
  assert.equal(b.status, 'live')
  const byName = Object.fromEntries(b.rows.map(r => [r.name, r]))
  assert.equal(byName['Alex Green'].total, 20); assert.equal(byName['Alex Green'].thru, 'Thru 9')
  assert.equal(byName['Bea Brown'].thru, 'F'); assert.equal(byName['Bea Brown'].total, 18)
  assert.deepEqual(b.rows.map(r => r.name), ['Alex Green', 'Bea Brown', 'Cal White'])
  assert.equal(b.rows[0].name, 'Alex Green'); assert.equal(b.rows[0].position, 1)
  assert.equal(b.rows[2].name, 'Cal White') // same points as Bea but fewer holes played ranks lower
})

test('withdrawn players are not on the board', async () => {
  const m = new Mem(); seed(m, 'active', [{ id: 'r1', status: 'active', date: '2026-10-17' }])
  m.tables.scorecards.push(card('r1', 'a', 'Alex Green', pts(10, 9)), card('r1', 'b', 'Gone Player', pts(30, 18), 'withdrawn'))
  const b = (await buildBoardForTrip(asAdmin(m), 't1'))!
  assert.deepEqual(b.rows.map(r => r.name), ['Alex Green'])
})

test('Lappen: Saturday completed + Sunday cancelled, event completed -> single-round EVENT FINAL, cancelled round absent', async () => {
  const m = new Mem(); seed(m, 'completed', [{ id: 'sat', status: 'completed', date: '2026-10-17' }, { id: 'sun', status: 'cancelled', date: '2026-10-18' }])
  m.tables.scorecards.push(card('sat', 'a', 'Alex Green', pts(36)), card('sat', 'b', 'Bea Brown', pts(30)))
  m.tables.scorecards.push(card('sun', 'a', 'Alex Green', pts(99)), card('sun', 'b', 'Bea Brown', pts(99))) // must be ignored
  const b = (await buildBoardForTrip(asAdmin(m), 't1'))!
  assert.equal(b.status, 'final'); assert.equal(b.roundLabel, '1 round'); assert.deepEqual(b.roundColumns, [])
  assert.deepEqual(b.rows.map(r => [r.name, r.total, r.position]), [['Alex Green', 36, 1], ['Bea Brown', 30, 2]])
})

test('between rounds: R1 completed, R2 upcoming -> ROUND COMPLETE; then R2 live -> LIVE with cumulative R1/R2; then both done -> EVENT FINAL', async () => {
  const m = new Mem(); seed(m, 'active', [{ id: 'r1', status: 'completed', date: '2026-10-17' }, { id: 'r2', status: 'upcoming', date: '2026-10-18' }])
  m.tables.scorecards.push(card('r1', 'a', 'Alex Green', pts(30)), card('r1', 'b', 'Bea Brown', pts(33)))
  let b = (await buildBoardForTrip(asAdmin(m), 't1'))!
  assert.equal(b.status, 'round_complete'); assert.deepEqual(b.rows.map(r => r.name), ['Bea Brown', 'Alex Green'])

  m.tables.rounds.find(r => r.id === 'r2')!.status = 'active'
  m.tables.scorecards.push(card('r2', 'a', 'Alex Green', pts(20, 9)), card('r2', 'b', 'Bea Brown', pts(10, 9)))
  b = (await buildBoardForTrip(asAdmin(m), 't1'))!
  assert.equal(b.status, 'live'); assert.deepEqual(b.roundColumns, [{ label: 'R1', live: false }, { label: 'R2', live: true }])
  assert.deepEqual(b.rows.map(r => [r.name, r.total, r.rounds]), [['Alex Green', 50, [30, 20]], ['Bea Brown', 43, [33, 10]]])
  assert.deepEqual(b.rows.map(r => r.thru), ['Thru 9', 'Thru 9'])

  m.tables.rounds.find(r => r.id === 'r2')!.status = 'completed'; m.tables.trips[0].status = 'completed'
  b = (await buildBoardForTrip(asAdmin(m), 't1'))!
  assert.equal(b.status, 'final'); assert.equal(b.roundLabel, '2 rounds'); assert.deepEqual(b.rows.map(r => r.thru), [null, null])
})

test('practice and unknown events have no public board', async () => {
  const m = new Mem(); seed(m, 'active', [{ id: 'r1', status: 'active', date: '2026-10-17' }]); m.tables.trips[0].is_practice = true
  assert.equal(await buildBoardForTrip(asAdmin(m), 't1'), null)
  assert.equal(await buildBoardForTrip(asAdmin(m), 'nope'), null)
})

test('a failing scorecard read throws (the route answers 500), never a wrong board', async () => {
  const m = new Mem(); seed(m, 'active', [{ id: 'r1', status: 'active', date: '2026-10-17' }])
  const real = m.from.bind(m)
  m.from = (t: string) => { const q = real(t); return t === 'scorecards' ? Object.assign(Object.create(q), { then: (a: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'boom' } }).then(a) }) : q }
  await assert.rejects(() => quiet(() => buildBoardForTrip(asAdmin(m), 't1')), /leaderboard computation failed/)
})

test('PUBLIC board equals the MEMBER leaderboard: same positions and points from the one canonical computation', async () => {
  const m = new Mem(); seed(m, 'active', [{ id: 'r1', status: 'active', date: '2026-10-17' }])
  const players = Array.from({ length: 20 }, (_, i) => card('r1', `p${i}`, `Player ${i}`, pts(10 + ((i * 7) % 23), 9 + (i % 10))))
  m.tables.scorecards.push(...players)
  const member = await computeRoundLeaderboard(asAdmin(m) as never, { tripId: 't1', roundId: 'r1', roundRow: m.tables.rounds[0] as never, viewerId: 'p3' })
  assert.ok(member.ok)
  const pub = (await buildBoardForTrip(asAdmin(m), 't1'))!
  assert.deepEqual(pub.rows.map(r => [r.name, r.total, r.position]), member.ok ? member.body.board.map(r => [r.name, r.totalPts, r.position]) : [])
  assert.equal(pub.rows.length, 20)
})

for (const size of [20, 50]) {
  test(`${size}-player live board builds fully, ranks correctly and leaks no private fields`, async () => {
    const m = new Mem(); seed(m, 'active', [{ id: 'r1', status: 'active', date: '2026-10-17' }])
    for (let i = 0; i < size; i++) m.tables.scorecards.push(card('r1', `p${i}`, `Golfer ${i} Surname`, pts(8 + ((i * 11) % 30), 6 + (i % 13))))
    const b = (await buildBoardForTrip(asAdmin(m), 't1'))!
    assert.equal(b.rows.length, size)
    for (let i = 1; i < b.rows.length; i++) assert.ok(b.rows[i - 1].total >= b.rows[i].total, 'sorted by points')
    assert.equal(b.rows[0].position, 1)
    const json = JSON.stringify(b)
    for (const leak of ['p1"', 'playerId', 'avatar', 'handicap', 'stroke_index']) assert.equal(json.includes(leak), false, leak)
  })
}
