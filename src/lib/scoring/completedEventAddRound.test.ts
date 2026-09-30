import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// P0 Completed Event -> Add Round -> continue social series audit
// (10 Sep) -- source-scanning contract tests against the real
// PATCH /api/trips/[tripId] route, since no live Postgres connection
// exists in this environment to exercise the actual reconciliation
// against real rows.

function readTripsRoute(): string {
  return fs.readFileSync(path.join(process.cwd(), 'src', 'app', 'api', 'trips', '[tripId]', 'route.ts'), 'utf8')
}

test('an archived trip is rejected before any round reconciliation runs at all', () => {
  const ts = readTripsRoute()
  const archivedCheckIndex = ts.indexOf("status === 'archived'")
  const roundsReconcileIndex = ts.indexOf('const rounds = (body.rounds')
  assert.ok(archivedCheckIndex > -1, 'archived-block check not found')
  assert.ok(roundsReconcileIndex > -1, 'rounds reconciliation not found')
  assert.ok(archivedCheckIndex < roundsReconcileIndex, 'the archived check must run before any round is read/reconciled from the request body')
})

test('the completed -> ongoing-series revert target is "ready", not "live" -- must not misclassify under Live Now', () => {
  const ts = readTripsRoute()
  // The revert block itself, isolated by its own log line, so this
  // doesn't accidentally match some unrelated 'live' reference
  // elsewhere in a large file.
  const revertBlockMatch = ts.match(/allStillComplete[\s\S]*?trip lifecycle reverted[\s\S]*?\)/)
  assert.ok(revertBlockMatch, 'the completed -> * revert block was not found')
  assert.match(revertBlockMatch![0], /status:\s*'ready'/)
  assert.doesNotMatch(revertBlockMatch![0], /status:\s*'live'/)
})

test('the revert only ever fires when the trip is currently completed -- never for an archived or already-live trip', () => {
  const ts = readTripsRoute()
  const revertBlockMatch = ts.match(/if \(tripStatusRes\.data\?\.status ===[\s\S]*?\}\s*\}\s*\}/)
  assert.ok(revertBlockMatch, 'revert condition block not found')
  assert.match(revertBlockMatch![0], /tripStatusRes\.data\?\.status === 'completed'/)
})

test('the revert is derived from the current, fully re-fetched round set on every save -- not a count fixed at trip creation', () => {
  const ts = readTripsRoute()
  assert.match(ts, /finalRoundsRes[\s\S]{0,200}from\('rounds'\)[\s\S]{0,100}eq\('trip_id', tripId\)/)
  assert.match(ts, /allStillComplete = finalRounds\.every\(r => r\.status === 'completed'\)/)
})

test('an existing active or completed round is never deleted through this route, even if omitted from the incoming array', () => {
  const ts = readTripsRoute()
  const toDeleteMatch = ts.match(/const toDelete = [^\n]*/)
  assert.ok(toDeleteMatch, 'toDelete computation not found')
  assert.match(toDeleteMatch![0], /r\.status === 'upcoming'/)
})

test('a matched existing round is updated in place by id, never deleted and reinserted', () => {
  const ts = readTripsRoute()
  assert.match(ts, /const toUpdate = rounds\.filter\(r => r\.id && existingById\.has\(r\.id\)\)/)
  assert.match(ts, /\.from\('rounds'\)\s*\.update\(updatePayload\)\s*\.eq\('id', r\.id/)
})

test('a genuinely new round (no matching existing id) is inserted, never confused with an update to an existing one', () => {
  const ts = readTripsRoute()
  assert.match(ts, /const toInsert = rounds\.filter\(r => !r\.id \|\| !existingById\.has\(r\.id\)\)/)
})

test('this route never writes to trip_members or trip_groups -- adding a round cannot duplicate players or groups', () => {
  const ts = readTripsRoute()
  assert.doesNotMatch(ts, /\.from\('trip_members'\)\.(insert|upsert)/)
  assert.doesNotMatch(ts, /\.from\('trip_groups'\)\.(insert|upsert)/)
})
