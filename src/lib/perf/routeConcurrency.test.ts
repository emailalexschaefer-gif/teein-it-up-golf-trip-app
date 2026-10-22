import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { runGet } from './harness/runRoute'
import { tablesFor, MY_SCORES_SCENARIOS, LEADERBOARD_SCENARIOS, TOURNAMENT_SCENARIOS, type Scenario } from './harness/scenarios'
import type { CallRecord } from './harness/fakeDb'

// Release 3 / Package 3A — the optimised routes must (a) really overlap
// independent reads, (b) never start the heavy reads for a caller who fails an
// authorisation/identity gate, and (c) stay within a fixed number of serial
// "waves". Latency is simulated (FakeDb), so these assert STRUCTURE, not real
// Supabase timings.

const routePath = (name: string) =>
  fileURLToPath(new URL(`../../app/api/trips/[tripId]/rounds/[roundId]/${name}/route.ts`, import.meta.url))
const LAT = 25

const find = (list: Scenario[], name: string) => {
  const s = list.find(x => x.name === name)
  assert.ok(s, `scenario missing: ${name}`)
  return s!
}
async function run(route: string, s: Scenario, latencyMs = LAT) {
  return runGet(routePath(route), s.params, { user: s.user, tables: tablesFor(s), latencyMs, fail: s.fail, failRules: s.failRules })
}
/** serial waves: queries that never overlap in time with an earlier one's window start a new wave */
function waves(calls: CallRecord[]): number {
  const sorted = [...calls].sort((a, b) => a.startedAt - b.startedAt)
  let n = 0, waveEnd = -1
  for (const c of sorted) {
    if (c.startedAt >= waveEnd - 6) { n++; waveEnd = c.endedAt } else waveEnd = Math.max(waveEnd, c.endedAt)
  }
  return n
}
const tablesOf = (calls: CallRecord[]) => new Set(calls.map(c => c.table))

// ---- my-scores -------------------------------------------------------------
test('my-scores: non-member (403) never reads scorecards, markers or audits', async () => {
  const r = await run('my-scores', find(MY_SCORES_SCENARIOS, 'non-member of the event -> 403'))
  assert.equal(r.status, 403)
  assert.deepEqual([...tablesOf(r.db.calls)].sort(), ['rounds', 'trip_members'])
})
test('my-scores: round of another event (404) never reads scorecards', async () => {
  const r = await run('my-scores', find(MY_SCORES_SCENARIOS, 'round belongs to another event -> 404'))
  assert.equal(r.status, 404)
  assert.ok(!tablesOf(r.db.calls).has('scorecards'))
})
test('my-scores: group_scorer round (400) never reads scorecards', async () => {
  const r = await run('my-scores', find(MY_SCORES_SCENARIOS, 'group_scorer round -> 400'))
  assert.equal(r.status, 400)
  assert.ok(!tablesOf(r.db.calls).has('scorecards'))
})
test('my-scores: unauthenticated (401) makes no database query', async () => {
  const r = await run('my-scores', find(MY_SCORES_SCENARIOS, 'not signed in -> 401'))
  assert.equal(r.status, 401)
  assert.equal(r.db.calls.length, 0)
})
test('my-scores: happy path overlaps reads and needs at most 3 serial waves (was 9 hops)', async () => {
  const r = await run('my-scores', find(MY_SCORES_SCENARIOS, 'shared-device digital player p3 with paper partner p4'))
  assert.equal(r.status, 200)
  assert.ok(r.db.maxConcurrent >= 3, `maxConcurrent ${r.db.maxConcurrent}`)
  assert.ok(waves(r.db.calls) <= 3, `waves ${waves(r.db.calls)}`)
})
test('my-scores: marker pair — round_markers read runs alongside scorecards', async () => {
  const r = await run('my-scores', find(MY_SCORES_SCENARIOS, 'player p2 (marker pair)'))
  const m = r.db.calls.find(c => c.table === 'round_markers')!
  const sc = r.db.calls.find(c => c.table === 'scorecards')!
  assert.ok(m && sc)
  assert.ok(Math.abs(m.startedAt - sc.startedAt) < LAT / 2, 'markers and scorecards started together')
})
test('my-scores: results never depend on which read finishes first (jittered latency)', async () => {
  const s = find(MY_SCORES_SCENARIOS, 'shared-device digital player p3 with paper partner p4')
  const base = await run('my-scores', s, 0)
  for (const lat of [1, 7, 31]) {
    const r = await run('my-scores', s, lat)
    assert.deepEqual(JSON.parse(JSON.stringify(r.body)), JSON.parse(JSON.stringify(base.body)))
  }
})

// ---- leaderboard -----------------------------------------------------------
test('leaderboard: non-member (403) never reads holes or scorecards', async () => {
  const r = await run('leaderboard', find(LEADERBOARD_SCENARIOS, 'non-member -> 403'))
  assert.equal(r.status, 403)
  assert.ok(!tablesOf(r.db.calls).has('scorecards') && !tablesOf(r.db.calls).has('holes'))
})
test('leaderboard: happy path uses far fewer serial waves than the 8 sequential hops it had', async () => {
  const r = await run('leaderboard', find(LEADERBOARD_SCENARIOS, 'p1 on active round 2 (cumulative with round 1)'))
  assert.equal(r.status, 200)
  assert.ok(r.db.maxConcurrent >= 3)
  assert.ok(waves(r.db.calls) <= 5, `waves ${waves(r.db.calls)}`)
})

// ---- tournament ------------------------------------------------------------
test('tournament: non-member (403) never reads scorecards', async () => {
  const r = await run('tournament', find(TOURNAMENT_SCENARIOS, TOURNAMENT_SCENARIOS.find(s => /403/.test(s.name))!.name))
  assert.equal(r.status, 403)
  assert.ok(!tablesOf(r.db.calls).has('scorecards'))
})
test('tournament: happy path overlaps reads (was 11+ sequential hops)', async () => {
  const s = TOURNAMENT_SCENARIOS.find(x => x.user && /organiser|player|p1/i.test(x.name) && !/\b(4\d\d|5\d\d|error|fail)/i.test(x.name))!
  const r = await run('tournament', s)
  assert.equal(r.status, 200, s.name)
  assert.ok(r.db.maxConcurrent >= 4, `maxConcurrent ${r.db.maxConcurrent}`)
  assert.ok(waves(r.db.calls) <= 6, `waves ${waves(r.db.calls)}`)
})

// ---- no cross-event leakage -------------------------------------------------
for (const [route, list] of [['my-scores', MY_SCORES_SCENARIOS], ['leaderboard', LEADERBOARD_SCENARIOS], ['tournament', TOURNAMENT_SCENARIOS]] as const) {
  test(`${route}: every scorecard/entry read is scoped to the requested round or trip`, async () => {
    for (const s of list.filter(x => x.user && !x.fail && !x.failRules)) {
      const r = await run(route, s, 0)
      for (const c of r.db.calls.filter(c => c.table === 'scorecards' || c.table === 'trip_members' || c.table === 'rounds')) {
        assert.ok(c.filters.some(f => /^eq:(round_id|trip_id|id|group_id|scorecard_id)=/.test(f)), `${route}/${s.name}: unscoped ${c.table} query ${c.filters.join(',')}`)
      }
    }
  })
}
