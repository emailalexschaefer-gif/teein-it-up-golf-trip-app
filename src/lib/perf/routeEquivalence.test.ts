import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runGet } from './harness/runRoute'
import { tablesFor, MY_SCORES_SCENARIOS, LEADERBOARD_SCENARIOS, TOURNAMENT_SCENARIOS, type Scenario } from './harness/scenarios'

// Release 3 / Package 3A — response-equivalence tests.
//
// The goldens in ./goldens/*.json were recorded by running the ORIGINAL
// (sequential, Release 2) route handlers through this same harness against
// the scenarios in ./harness/scenarios.ts. These tests run the CURRENT
// routes against the same scenarios and require the exact same HTTP status
// and JSON body — including every error path (401/403/404/400/500, tolerated
// query errors, and network failures).
//
// To re-record (only when a route's behaviour is INTENTIONALLY changed):
//   TIU_UPDATE_GOLDENS=1 node --import <tsx loader> --test src/lib/perf/routeEquivalence.test.ts

const ROUTES = {
  'my-scores': MY_SCORES_SCENARIOS,
  leaderboard: LEADERBOARD_SCENARIOS,
  tournament: TOURNAMENT_SCENARIOS,
} as const

const routePath = (name: string) =>
  fileURLToPath(new URL(`../../app/api/trips/[tripId]/rounds/[roundId]/${name}/route.ts`, import.meta.url))
const goldenPath = (name: string) => fileURLToPath(new URL(`./goldens/${name}.json`, import.meta.url))

const UPDATE = process.env.TIU_UPDATE_GOLDENS === '1'

async function run(route: string, s: Scenario) {
  const res = await runGet(routePath(route), s.params, {
    user: s.user, tables: tablesFor(s), fail: s.fail, failRules: s.failRules,
  })
  return { status: res.status, body: JSON.parse(JSON.stringify(res.body)) }
}

for (const [route, scenarios] of Object.entries(ROUTES)) {
  if (UPDATE) {
    test(`record goldens: ${route}`, async () => {
      const out: Record<string, unknown> = {}
      for (const s of scenarios) out[s.name] = await run(route, s)
      writeFileSync(goldenPath(route), JSON.stringify(out, null, 2) + '\n')
    })
    continue
  }
  const golden: Record<string, { status: number; body: unknown }> =
    existsSync(goldenPath(route)) ? JSON.parse(readFileSync(goldenPath(route), 'utf8')) : {}
  for (const s of scenarios) {
    test(`${route}: ${s.name} — same status and body as the original route`, async () => {
      assert.ok(golden[s.name], `no golden recorded for "${s.name}"`)
      const actual = await run(route, s)
      assert.deepEqual(actual, golden[s.name])
    })
  }
  test(`${route}: every scenario has a golden and there are no orphan goldens`, () => {
    assert.deepEqual(Object.keys(golden).sort(), scenarios.map(s => s.name).sort())
  })
}
