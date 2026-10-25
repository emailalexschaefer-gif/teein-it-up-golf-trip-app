/**
 * Package 3: Finish Round Early -- app-side regression tests run through the REAL modules
 * (computeRoundLeaderboard, computeFinalResults, buildBoardForTrip, endEvent, the share exports)
 * over an in-memory database. The database function itself (which nine qualifies) is covered by
 * supabase/tests/100_finish_round_early.test.sql and by the optional PG runner at the bottom.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { FakeDb, type Row } from '@/lib/perf/harness/fakeDb'
import { computeRoundLeaderboard } from '@/lib/scoring/roundLeaderboard'
import { computeFinalResults } from '@/lib/trips/finalResults'
import { buildBoardForTrip } from '@/lib/leaderboardShare/service'
import { boardFootnote } from '@/lib/leaderboardShare/publicBoard'
import { computePngLayout } from '@/lib/leaderboardShare/exportPng'
import { buildLeaderboardPdf } from '@/lib/leaderboardShare/exportPdf'
import { endEvent, canConcludeCompetition } from '@/lib/scoring/eventEnd'
import { finishRoundEarly, previewFinishEarly, parseFinishEarlyInput, mapEarlyFinishError, summariseSnapshot, diffSnapshots, parseEarlyFinish, type SnapshotRow } from '@/lib/scoring/earlyFinish'
import { cumulativeThroughRounds } from '@/lib/trips/cumulativeThroughRound'

const rd = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), 'utf8')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asAny = (x: unknown): any => x

// ── fixture: Round 1 normal (18 holes), Round 2 finished early (rain) ────────────────────────────
const TRIP = 't1'
const PLAYERS = [['A', 'Alex'], ['B', 'Bea'], ['S', 'Sam']] as const
function holes(round: string): Row[] { return Array.from({ length: 18 }, (_, i) => ({ id: `${round}-h${i + 1}`, round_id: round, hole_number: i + 1, par: 4, stroke_index: i + 1 })) }
function card(round: string, pid: string, name: string, pts: number[], extra: Row = {}): Row {
  return {
    id: `${round}-${pid}`, round_id: round, player_id: pid, group_id: null, status: 'submitted', playing_handicap: 10,
    profiles: { full_name: name, avatar_url: null },
    score_entries: pts.map((p, i) => ({ id: `${round}-${pid}-${i + 1}`, hole_id: `${round}-h${i + 1}`, gross_score: 4, stableford_pts: p, is_no_return: false, capture_role: 'self' })),
    ...extra,
  }
}
const eighteen = (n: number) => Array.from({ length: 18 }, () => n)
function world(opts: { counts?: boolean | undefined; officialHoles?: number | null; early?: boolean; tripStatus?: string } = {}): Record<string, Row[]> {
  const early = opts.early !== false
  const common = { trip_id: TRIP, holes: 18, scoring_format: 'stableford', starting_hole_number: 1, course_name: 'Links' }
  return {
    trips: [{ id: TRIP, name: 'Rainy Open', status: opts.tripStatus ?? 'completed', is_practice: false, organiser_id: 'org' }],
    rounds: [
      { id: 'r1', name: 'Round 1', status: 'completed', play_date: '2026-10-01', created_at: '2026-10-01T00:00:00Z', ...common },
      { id: 'r2', name: 'Round 2', status: 'completed', play_date: '2026-10-02', created_at: '2026-10-02T00:00:00Z', ...common,
        ...(early ? { closed_early: true, closed_early_reason: 'weather', closed_early_note: 'PRIVATE ORGANISER NOTE', official_holes: opts.officialHoles === undefined ? 9 : opts.officialHoles, counts_toward_event: opts.counts === true } : {}) },
    ],
    holes: [...holes('r1'), ...holes('r2')],
    scorecards: [
      card('r1', 'A', 'Alex', eighteen(2)), card('r1', 'B', 'Bea', [...eighteen(2).slice(0, 12), ...eighteen(1).slice(0, 6)].slice(0, 18)), card('r1', 'S', 'Sam', [...eighteen(2), ].map((v, i) => (i < 4 ? 3 : v))),
      card('r2', 'A', 'Alex', Array.from({ length: 11 }, () => 2)),                       // 11 holes: actual 22, official 18
      card('r2', 'B', 'Bea', [2, 2, 2, 2, 2, 2, 2, 2, 1]),                                // exactly nine: 17
      card('r2', 'S', 'Sam', Array.from({ length: 6 }, () => 2)),                         // six holes: incomplete, actual 12
    ],
    round_official_results: opts.early === false ? [] : [
      { round_id: 'r2', player_id: 'A', result_kind: 'qualifying', official_points: 18, actual_points: 22, holes_played: 11, start_hole: 1, segment_holes: [1, 2, 3, 4, 5, 6, 7, 8, 9], segment_points: [2, 2, 2, 2, 2, 2, 2, 2, 2] },
      { round_id: 'r2', player_id: 'B', result_kind: 'qualifying', official_points: 17, actual_points: 17, holes_played: 9, start_hole: 1, segment_holes: [1, 2, 3, 4, 5, 6, 7, 8, 9], segment_points: [2, 2, 2, 2, 2, 2, 2, 2, 1] },
      { round_id: 'r2', player_id: 'S', result_kind: 'incomplete', official_points: null, actual_points: 12, holes_played: 6, start_hole: 1, segment_holes: null, segment_points: null },
    ],
  }
}
const db = (tables: Record<string, Row[]>) => asAny(new FakeDb({ tables }))
const R1_TOTAL: Record<string, number> = { A: 36, B: 30, S: 40 }
const quiet = async <T>(fn: () => Promise<T>): Promise<T> => { const e = console.error; console.error = () => {}; try { return await fn() } finally { console.error = e } }

// 1. normal 18-hole behaviour unchanged ---------------------------------------------------------
test('normal round: the leaderboard response has NO early-finish keys and no per-round "counted" flag (byte-identical to before)', async () => {
  const w = world({ early: false })
  const r = await computeRoundLeaderboard(db(w), { tripId: TRIP, roundId: 'r2', roundRow: { name: 'Round 2', holes: 18, scoring_format: 'stableford', starting_hole_number: 1 }, viewerId: null })
  assert.ok(r.ok)
  const body = r.ok ? r.body : null
  assert.ok(body && !('earlyFinish' in body) && !('notRankedStandings' in body))
  assert.ok(body!.board.every(b => !('ranked' in b) && !('resultKind' in b) && !('officialPoints' in b)))
  assert.ok(body!.cumulativeStandings.every(c => (c.rounds ?? []).every(x => !('counted' in x))))
  assert.deepEqual(body!.cumulativeStandings.map(c => [c.playerId, c.totalPoints]), [['A', 36 + 22], ['B', 30 + 17], ['S', 40 + 12]].sort((a, b) => (b[1] as number) - (a[1] as number)))
})

test('normal event: final results carry no early rounds and every player is ranked', async () => {
  const f = await computeFinalResults(TRIP, db(world({ early: false })))
  assert.ok(f.ok && f.data.earlyRounds.length === 0 && f.data.notRanked.length === 0 && f.data.championshipEmpty === false)
  assert.deepEqual((f.data as unknown as { standings: { playerId: string; totalPoints: number }[] }).standings.map(s => [s.playerId, s.totalPoints]), [['A', 58], ['S', 52], ['B', 47]])
})

// 2. default exclusion --------------------------------------------------------------------------
test('finished early + default (NOT counted): the championship ignores the round, every score stays visible', async () => {
  const f = await computeFinalResults(TRIP, db(world({ counts: false })))
  assert.ok(f.ok)
  const d = f.data as unknown as { standings: { playerId: string; totalPoints: number; rounds: { roundId: string; points: number; counted?: boolean }[] }[]; notRanked: unknown[]; earlyRounds: { countingLabel: string; title: string; resultLabel: string }[]; champions: { playerId: string }[]; roundWinners: { roundId: string; winners: { playerId: string; points: number }[] }[] }
  assert.deepEqual(d.standings.map(s => [s.playerId, s.totalPoints]), [['S', 40], ['A', 36], ['B', 30]])
  assert.deepEqual(d.notRanked, [])
  const sam = d.standings.find(s => s.playerId === 'S')!
  assert.equal(sam.rounds.find(r => r.roundId === 'r2')!.points, 12, 'Sam’s real Round 2 points are still shown')
  assert.equal(sam.rounds.find(r => r.roundId === 'r2')!.counted, false)
  assert.deepEqual(d.champions.map(c => c.playerId), ['S'])
  assert.deepEqual(d.earlyRounds.map(e => [e.title, e.resultLabel, e.countingLabel]), [['Round Finished Early — Weather', 'Official 9-Hole Result', 'Not Counted Toward Event Championship']])
  // the shortened round still has a winner, decided on official results among qualifying players only
  assert.deepEqual(d.roundWinners.find(r => r.roundId === 'r2')!.winners.map(w => [w.playerId, w.points]), [['A', 18]])
})

// 3. explicit inclusion -------------------------------------------------------------------------
test('explicit inclusion: only qualifying official points count; the 11-hole player counts nine; the incomplete player is NOT ranked and NOT zeroed', async () => {
  const f = await computeFinalResults(TRIP, db(world({ counts: true })))
  assert.ok(f.ok)
  const d = f.data as unknown as { standings: { playerId: string; totalPoints: number; position: number }[]; notRanked: { playerId: string; totalPoints: number }[]; champions: { playerId: string }[]; earlyRounds: { countingLabel: string }[] }
  assert.deepEqual(d.standings.map(s => [s.playerId, s.totalPoints]), [['A', 54], ['B', 47]])
  assert.deepEqual(d.notRanked.map(n => [n.playerId, n.totalPoints]), [['S', 52]], 'actual points kept (40 + 12), never turned into zero')
  assert.ok(!d.standings.some(s => s.playerId === 'S'))
  assert.deepEqual(d.champions.map(c => c.playerId), ['A'])
  assert.equal(d.earlyRounds[0].countingLabel, 'Counts Toward Event Championship')
})

test('finished early with NO official result: nobody is ranked for that round, no round winner, nothing counts', async () => {
  const w = world({ counts: false, officialHoles: null }); w.round_official_results = []
  const f = await computeFinalResults(TRIP, db(w))
  assert.ok(f.ok)
  const d = f.data as unknown as { roundWinners: { roundId: string; winners: unknown[] }[]; standings: { playerId: string }[] }
  assert.deepEqual(d.roundWinners.find(r => r.roundId === 'r2')!.winners, [])
  assert.equal(d.standings.length, 3)
})

test('every round excluded: no ranking exists, no champion is claimed, scores kept', async () => {
  const w = world({ counts: false }); w.rounds = [w.rounds[1]]; w.scorecards = w.scorecards.filter(s => s.round_id === 'r2')
  const f = await computeFinalResults(TRIP, db(w))
  assert.ok(f.ok)
  const d = f.data as unknown as { standings: unknown[]; champions: unknown[]; championshipEmpty: boolean }
  assert.deepEqual([d.standings.length, d.champions.length, d.championshipEmpty], [0, 0, true])
})

test('event highlights: Event Champion follows the same rule; wipes/birdies and other stats still use the real scores of the shortened round', async () => {
  const included = await computeFinalResults(TRIP, db(world({ counts: true })))
  const excluded = await computeFinalResults(TRIP, db(world({ counts: false })))
  assert.ok(included.ok && excluded.ok)
  const champ = (x: typeof included) => (x.ok ? (x.data.eventHighlights as { makers: { category: string; playerNames: string[] }[] }).makers.find(m => m.category === 'event_champion')?.playerNames : undefined)
  assert.deepEqual(champ(included), ['Alex'])
  assert.deepEqual(champ(excluded), ['Sam'])
})

// 4. live round board ---------------------------------------------------------------------------
test('the shortened round’s own board ranks qualifying players on official points; the incomplete player is listed apart with real points', async () => {
  const r = await computeRoundLeaderboard(db(world({ counts: true })), { tripId: TRIP, roundId: 'r2', roundRow: { name: 'Round 2', holes: 18, scoring_format: 'stableford', starting_hole_number: 1 }, viewerId: null })
  assert.ok(r.ok)
  const b = r.ok ? r.body : null
  assert.deepEqual(b!.board.map(x => [x.playerId, x.position, x.ranked, x.officialPoints ?? null, x.totalPts]), [['A', 1, true, 18, 22], ['B', 2, true, 17, 17], ['S', 0, false, null, 12]])
  assert.equal(b!.earlyFinish!.title, 'Round Finished Early — Weather')
  assert.deepEqual(b!.notRankedStandings!.map(n => n.playerId), ['S'])
  assert.deepEqual(b!.cumulativeStandings.map(c => [c.playerId, c.totalPoints]), [['A', 54], ['B', 47]])
})

// 5. public link / PNG / PDF agree --------------------------------------------------------------
test('public board, PNG and PDF all show the early label, the not-counted/counted label and the not-ranked player; no private note or ids leak', async () => {
  const included = (await buildBoardForTrip(db(world({ counts: true })), TRIP))!
  assert.deepEqual(included.rows.map(r => [r.name, r.total]), [['Alex', 54], ['Bea', 47]])
  assert.deepEqual(included.notRanked, [{ name: 'Sam', total: 52 }])
  const foot = boardFootnote(included)!
  for (const part of ['Round Finished Early — Weather', 'Official 9-Hole Result', 'Counts Toward Event Championship', 'Not ranked — incomplete round', 'Sam (52 pts)']) assert.ok(foot.includes(part), part)
  const layout = computePngLayout(included, t => [t])
  assert.ok(layout.noteLines.join(' ').includes('Not ranked — incomplete round'))
  const pdf = Buffer.from(buildLeaderboardPdf(included)).toString('latin1')
  assert.ok(pdf.includes('Not ranked') && pdf.includes('Round Finished Early'))
  const json = JSON.stringify(included)
  assert.ok(!json.includes('PRIVATE ORGANISER NOTE'), 'organiser note never reaches the public board')
  assert.ok(!/"playerId"|"player_id"|"id":/.test(json), 'no ids on the public board')

  const excluded = (await buildBoardForTrip(db(world({ counts: false })), TRIP))!
  assert.ok(boardFootnote(excluded)!.includes('Not Counted Toward Event Championship'))
  assert.deepEqual(excluded.rows.map(r => [r.name, r.total]), [['Sam', 40], ['Alex', 36], ['Bea', 30]])
})

test('a normal event’s public board is unchanged (no extra fields, no extra text)', async () => {
  const b = (await buildBoardForTrip(db(world({ early: false })), TRIP))!
  assert.ok(!('notRanked' in b) && !('earlyNotes' in b))
  assert.equal(boardFootnote(b), b.note)
})

// 6. presentation / memories cumulative -----------------------------------------------------------
test('presentation cumulative-after-round: excluded round adds nothing; included round lists the incomplete player apart', () => {
  const results = new Map([
    ['r1', [{ playerId: 'A', playerName: 'Alex', roundPoints: 36, holePoints: [] }, { playerId: 'S', playerName: 'Sam', roundPoints: 40, holePoints: [] }]],
    ['r2', [{ playerId: 'A', playerName: 'Alex', roundPoints: 22, holePoints: [] }, { playerId: 'S', playerName: 'Sam', roundPoints: 12, holePoints: [] }]],
  ])
  const rounds = [{ id: 'r1', status: 'completed' }, { id: 'r2', status: 'completed' }]
  const mk = (counts: boolean) => parseEarlyFinish([{ id: 'r2', closed_early: true, closed_early_reason: 'weather', official_holes: 9, counts_toward_event: counts }],
    [{ round_id: 'r2', player_id: 'A', result_kind: 'qualifying', official_points: 18, actual_points: 22, holes_played: 11, segment_points: [2, 2, 2, 2, 2, 2, 2, 2, 2] }, { round_id: 'r2', player_id: 'S', result_kind: 'incomplete', actual_points: 12, holes_played: 6 }])
  const ex = cumulativeThroughRounds(rounds, results, 5, mk(false)).get('r2')!
  assert.deepEqual(ex.standings.map(s => [s.playerName, s.totalPoints]), [['Sam', 40], ['Alex', 36]]); assert.equal(ex.notRanked, undefined)
  const inc = cumulativeThroughRounds(rounds, results, 5, mk(true)).get('r2')!
  assert.deepEqual(inc.standings.map(s => [s.playerName, s.totalPoints]), [['Alex', 54]])
  assert.deepEqual(inc.notRanked!.map(n => [n.playerName, n.totalPoints]), [['Sam', 52]])
  assert.deepEqual(cumulativeThroughRounds(rounds, results).get('r2')!.standings.map(s => s.totalPoints), [58, 52], 'no early info = exactly today’s behaviour')
})

// 7. lifecycle: three separate actions ----------------------------------------------------------
test('three separate actions: Cancel Round stays upcoming-only; Finish Early needs an ACTIVE round; Close Round is untouched', () => {
  const cancel = rd('src/app/api/trips/[tripId]/rounds/[roundId]/cancel/route.ts')
  assert.match(cancel, /upcoming/)
  const fin = rd('src/lib/scoring/earlyFinish.ts') + rd('supabase/migrations/100_round_finish_early.sql')
  assert.match(fin, /ROUND_NOT_ACTIVE/)
  assert.doesNotMatch(rd('supabase/migrations/100_round_finish_early.sql').replace(/--.*$/gm, ''), /status\s*=\s*'cancelled'|'cancelled'/, 'finishing early never sets cancelled')
  assert.doesNotMatch(rd('src/lib/scoring/earlyFinish.ts'), /status: 'cancelled'|cancelled_at/)
  const close = rd('src/app/api/trips/[tripId]/rounds/[roundId]/close/route.ts')
  assert.doesNotMatch(close, /closed_early|earlyFinish|round_official_results/, 'normal Close Round is untouched')
})

test('finish-early routes are organiser-only and never complete the event or choose a champion', () => {
  for (const f of ['finish-early', 'early-results']) {
    const s = rd(`src/app/api/trips/[tripId]/rounds/[roundId]/${f}/route.ts`)
    assert.match(s, /role !== 'organiser'/)
    assert.doesNotMatch(s, /trips'\)\.update|champion_declared|status: 'completed'/)
  }
  const svc = rd('src/lib/scoring/earlyFinish.ts')
  assert.doesNotMatch(svc, /from\('trips'\)\.update/)
  assert.doesNotMatch(svc, /declareChampion|champion_declared/)
})

// 8. service behaviour --------------------------------------------------------------------------
function fakeRpcAdmin(round: { status: string } | null, rpcResult: { data?: unknown; error?: { message: string } } = { data: { ok: true } }) {
  const calls: { fn: string; args: unknown }[] = []; const writes: string[] = []
  const admin = {
    calls, writes,
    from(t: string) { const q = { select() { return q }, eq() { return q }, in() { return q }, update() { writes.push(`update ${t}`); return q }, insert() { writes.push(`insert ${t}`); return q }, maybeSingle: async () => ({ data: round ? { id: 'r2', ...round } : null }), then: (a: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(a) }; return q },
    async rpc(fn: string, args: unknown) { calls.push({ fn, args }); return fn === 'finalize_side_comp_winners' ? { data: null, error: null } : { data: rpcResult.data ?? null, error: rpcResult.error ?? null } },
  }
  return admin
}
const body = { reason: 'weather', note: ' wet ', countsTowardEvent: undefined as unknown, officialResult: 'nine_hole', acknowledgeMixedNines: undefined as unknown }

test('finish early: one atomic database call; inclusion defaults to NO; the app writes nothing else and never completes the event', async () => {
  const a = fakeRpcAdmin({ status: 'active' })
  const r = await finishRoundEarly(asAny(a), { tripId: TRIP, roundId: 'r2', actorId: 'org', body })
  assert.equal(r.status, 200)
  const fin = a.calls.filter(c => c.fn === 'finish_round_early')
  assert.equal(fin.length, 1)
  assert.deepEqual(fin[0].args, { p_round_id: 'r2', p_actor: 'org', p_reason: 'weather', p_note: 'wet', p_counts: false, p_official_holes: 9, p_ack_mixed: false })
  assert.deepEqual(a.writes, [], 'no table is written by the app: round, decisions, snapshots and audit all happen inside the one database function')
  assert.deepEqual(a.calls.map(c => c.fn), ['finish_round_early', 'finalize_side_comp_winners'])
})

test('repeat / stale requests: a round that is no longer active is refused before any database write (no double close or double count)', async () => {
  const a = fakeRpcAdmin({ status: 'completed' })
  const r = await finishRoundEarly(asAny(a), { tripId: TRIP, roundId: 'r2', actorId: 'org', body })
  assert.equal(r.status, 409); assert.equal(a.calls.length, 0)
  const lost = fakeRpcAdmin({ status: 'active' }, { error: { message: 'ROUND_NOT_ACTIVE' } })   // lost the race at the database
  const r2 = await quiet(() => finishRoundEarly(asAny(lost), { tripId: TRIP, roundId: 'r2', actorId: 'org', body }))
  assert.equal(r2.status, 409); assert.ok(!lost.calls.some(c => c.fn === 'finalize_side_comp_winners'), 'nothing follows a failed finish')
})

test('partial failure leaves nothing behind: an error from the database function is reported, nothing else runs', async () => {
  const a = fakeRpcAdmin({ status: 'active' }, { error: { message: 'duplicate key value violates unique constraint' } })
  const r = await quiet(() => finishRoundEarly(asAny(a), { tripId: TRIP, roundId: 'r2', actorId: 'org', body }))
  assert.equal(r.status, 500); assert.deepEqual(a.calls.map(c => c.fn), ['finish_round_early']); assert.deepEqual(a.writes, [])
  assert.doesNotMatch(String(r.body.error), /duplicate key|constraint/, 'no SQL text leaks')
})

test('a missing migration 100 is a clear 503, not a crash, and changes nothing', async () => {
  const a = fakeRpcAdmin({ status: 'active' }, { error: { message: 'Could not find the function public.finish_round_early in the schema cache' } })
  const r = await quiet(() => finishRoundEarly(asAny(a), { tripId: TRIP, roundId: 'r2', actorId: 'org', body }))
  assert.equal(r.status, 503); assert.equal(mapEarlyFinishError({ code: '42883' }).code, 'MIGRATION_PENDING')
})

test('validation: reason required, inclusion needs an official result and a literal true, mixed-nines ack must be literal true', () => {
  assert.equal(parseFinishEarlyInput({ ...body, reason: 'golf' }).ok, false)
  assert.equal(parseFinishEarlyInput({ ...body, officialResult: 'other' }).ok, false)
  assert.equal(parseFinishEarlyInput({ ...body, officialResult: 'none', countsTowardEvent: true }).ok, false)
  const p = parseFinishEarlyInput({ ...body, countsTowardEvent: 'yes', acknowledgeMixedNines: 'true' })
  assert.ok(p.ok && p.counts === false && p.ackMixed === false)
  const q = parseFinishEarlyInput({ ...body, countsTowardEvent: true, acknowledgeMixedNines: true })
  assert.ok(q.ok && q.counts && q.ackMixed && q.officialHoles === 9)
  assert.equal(parseFinishEarlyInput({ ...body, note: 'x'.repeat(201) }).ok, false)
})

test('preview writes nothing and reports qualifying vs incomplete; an inactive round cannot be previewed', async () => {
  const rows: SnapshotRow[] = [
    { scorecard_id: 's1', player_id: 'A', start_hole: 1, holes_played: 11, actual_points: 22, playing_handicap: 10, segment_holes: [1], segment_points: [2], official_points: 18, result_kind: 'qualifying' },
    { scorecard_id: 's3', player_id: 'S', start_hole: 1, holes_played: 6, actual_points: 12, playing_handicap: 10, segment_holes: null, segment_points: null, official_points: null, result_kind: 'incomplete' },
  ]
  const s = summariseSnapshot(rows, new Map([['A', 'Alex'], ['S', 'Sam']]), false, 1, 'r2')
  assert.deepEqual([s.qualifying, s.incomplete, s.upcomingRoundsUntouched], [1, 1, 1])
  assert.deepEqual(s.players.map(p => [p.name, p.kind, p.officialPoints, p.actualPoints]), [['Alex', 'qualifying', 18, 22], ['Sam', 'incomplete', null, 12]])
  const a = fakeRpcAdmin({ status: 'completed' })
  assert.equal((await previewFinishEarly(asAny(a), TRIP, 'r2')).status, 409); assert.equal(a.calls.length, 0)
})

test('refresh preview: only a changed player is reported; identical results are not stale', () => {
  const stored = [...parseEarlyFinish([{ id: 'r2', closed_early: true, closed_early_reason: 'weather', official_holes: 9 }],
    [{ round_id: 'r2', player_id: 'A', result_kind: 'qualifying', official_points: 18, actual_points: 22, holes_played: 11, segment_points: [2, 2], segment_holes: [1, 2] }, { round_id: 'r2', player_id: 'S', result_kind: 'incomplete', actual_points: 12, holes_played: 6 }]).get('r2')!.results.values()]
  const same: SnapshotRow[] = [
    { scorecard_id: 's1', player_id: 'A', start_hole: 1, holes_played: 11, actual_points: 22, playing_handicap: 10, segment_holes: [1, 2], segment_points: [2, 2], official_points: 18, result_kind: 'qualifying' },
    { scorecard_id: 's3', player_id: 'S', start_hole: 1, holes_played: 6, actual_points: 12, playing_handicap: 10, segment_holes: null, segment_points: null, official_points: null, result_kind: 'incomplete' }]
  assert.equal(diffSnapshots(stored, same).stale, false)
  const corrected = same.map(r => (r.player_id === 'A' ? { ...r, segment_points: [3, 2], official_points: 19, actual_points: 23 } : r))
  assert.deepEqual(diffSnapshots(stored, corrected), { changed: ['A'], added: [], removed: [], stale: true })
})

// 9. Finish Event: concluded vs ended early -------------------------------------------------------
test('competition concluded needs every round played (none upcoming/cancelled), a shortened round, and a round that counts', () => {
  assert.equal(canConcludeCompetition([{ status: 'completed' }, { status: 'completed', closedEarly: true, countsTowardEvent: false }]).ok, true)
  assert.equal(canConcludeCompetition([{ status: 'completed' }, { status: 'upcoming' }]).ok, false)
  assert.equal(canConcludeCompetition([{ status: 'completed', closedEarly: true }, { status: 'cancelled' }]).ok, false)
  assert.equal(canConcludeCompetition([{ status: 'completed' }, { status: 'completed' }]).ok, false)
  assert.equal(canConcludeCompetition([{ status: 'completed', closedEarly: true, countsTowardEvent: false }]).ok, false, 'nothing counts: no champion to declare')
})

function endAdmin(tables: Record<string, Row[]>) {
  const writes: { table: string; patch: Row }[] = []
  const admin = {
    writes,
    from(table: string) {
      let patch: Row | null = null
      const q = {
        select() { return q }, eq() { return q }, neq() { return q }, in() { return q },
        update(p: Row) { patch = p; writes.push({ table, patch: p }); return q },
        insert() { return q },
        maybeSingle: async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null }),
        then: (a: (v: unknown) => unknown) => Promise.resolve(patch ? { data: [{ id: 'x' }], error: null } : { data: tables[table] ?? [], error: null }).then(a),
      }
      return q
    },
  }
  return admin
}
test('Finish Event as "concluded" is stored exactly like a normal completion (no ended-early flags, no cancelled rounds)', async () => {
  const w = world({ counts: false, tripStatus: 'live' })
  const a = endAdmin({ trips: w.trips, rounds: w.rounds, round_official_results: w.round_official_results })
  const prev = await endEvent(asAny(a), { tripId: TRIP, userId: 'org', preview: true })
  assert.equal(prev.body.canConclude, true)
  const r = await endEvent(asAny(a), { tripId: TRIP, userId: 'org', outcome: 'concluded' })
  assert.equal(r.status, 200); assert.equal(r.body.endedEarly, false); assert.equal(r.body.championDeclared, true)
  assert.deepEqual(a.writes, [{ table: 'trips', patch: { status: 'completed' } }])
})

test('Finish Event "concluded" is refused when a round was never played; End Event Early remains the path for that', async () => {
  const w = world({ counts: false, tripStatus: 'live' }); (w.rounds as Row[]).push({ id: 'r3', name: 'Round 3', status: 'upcoming', play_date: '2026-10-03', created_at: '2026-10-03T00:00:00Z', trip_id: TRIP, holes: 18 })
  const a = endAdmin({ trips: w.trips, rounds: w.rounds, round_official_results: w.round_official_results })
  const r = await endEvent(asAny(a), { tripId: TRIP, userId: 'org', outcome: 'concluded' })
  assert.equal(r.status, 409); assert.deepEqual(a.writes, [])
})

// 10. UI pins ------------------------------------------------------------------------------------
test('Finish Round Early dialog: inclusion defaults to NO, mixed nines need an extra confirmation, sits above the bottom nav with sticky buttons', () => {
  const s = rd('src/components/scoring/FinishRoundEarlyControl.tsx')
  assert.match(s, /useState\(false\) \/\/ default: NOT counted toward the championship/)
  assert.match(s, /Count this shortened round toward the event championship\?/)
  assert.match(s, /Groups played different nines/); assert.match(s, /needsAck/)
  assert.match(s, /zIndex: 120/); assert.match(s, /maxHeight: '88dvh'/); assert.match(s, /position: 'sticky'/)
  assert.match(s, /does not end the event and does not declare a champion/)
  assert.match(s, /Keep Round Active/)
  const hq = rd('src/components/scoring/MyHQClient.tsx')
  assert.match(hq, /selected\.status === 'active' && \(\s*<FinishRoundEarlyControl/)
  assert.match(hq, /selected\.status === 'completed' && \(\s*<EarlyResultsPanel/)
})

test('Refresh Official Results is explicit, organiser-driven and audited (no silent recalculation)', () => {
  const sql = rd('supabase/migrations/100_round_finish_early.sql')
  assert.match(sql, /results_refreshed/)
  const panel = rd('src/components/scoring/EarlyResultsPanel.tsx')
  assert.match(panel, /Refresh Official Results/); assert.match(panel, /may be out of date/)
  const sharedReaders = ['src/lib/scoring/roundLeaderboard.ts', 'src/lib/trips/finalResults.ts', 'src/lib/trips/eventMemoryData.ts'].map(rd).join('\n')
  assert.doesNotMatch(sharedReaders, /refresh_round_official_results|round_official_snapshot/, 'standings only ever READ frozen results')
})

// 11. optional: run the real-PostgreSQL scenario test when a scratch database is available ----------
const PG = process.env.TIU_PG_TEST === '1'
test('database scenarios (supabase/tests/100_finish_round_early.test.sql) on a real PostgreSQL', { skip: !PG && 'set TIU_PG_TEST=1 with PGHOST/PGPORT/PGUSER/PGDATABASE pointing at a scratch database that has migrations 001-100 applied' }, () => {
  const file = fileURLToPath(new URL('../../../supabase/tests/100_finish_round_early.test.sql', import.meta.url))
  assert.ok(existsSync(file))
  const res = spawnSync('psql', ['-v', 'ON_ERROR_STOP=1', '-X', '-q', '-f', file], { encoding: 'utf8' })
  const out = `${res.stdout}\n${res.stderr}` // the test reports PASS/FAIL as NOTICEs (stderr)
  assert.equal(res.status, 0, out.slice(-2000))
  assert.doesNotMatch(out, /FAIL/)
  assert.ok((out.match(/PASS/g) ?? []).length >= 40)
})
