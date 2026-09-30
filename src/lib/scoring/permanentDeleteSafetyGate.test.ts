import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// P0 Permanent Delete safety gate (10 Sep) -- source-scanning contract
// tests against the real migration and route files. No live Postgres
// connection exists in this environment, so the SQL function itself
// cannot be executed and asserted against real rows -- these tests
// instead verify the specific structural properties that determine
// correctness: which signals the function checks, that the DELETE
// route's operation order guarantees zero destructive work before
// rejection, and that the eligibility check and the actual delete gate
// are the same function (so they cannot silently drift apart).

const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations')
const appDir = path.join(process.cwd(), 'src', 'app', 'api', 'trips')

function readMigration(filename: string): string {
  return fs.readFileSync(path.join(migrationsDir, filename), 'utf8')
}
function readRoute(relativePath: string): string {
  return fs.readFileSync(path.join(appDir, relativePath), 'utf8')
}
function stripComments(sql: string): string {
  return sql.replace(/--.*$/gm, '')
}

const migration = () => stripComments(readMigration('084_trip_protected_history_check.sql'))

test('trip_has_protected_history checks a non-organiser trip_members row (someone genuinely joined)', () => {
  const sql = migration()
  assert.match(sql, /trip_members\s+WHERE\s+trip_id\s*=\s*p_trip_id\s+AND\s+role\s*<>\s*'organiser'/i)
})

test('trip_has_protected_history checks scorecards (scoring has commenced), not merely configured rounds', () => {
  const sql = migration()
  const fnMatch = sql.match(/RETURNS BOOLEAN[\s\S]*?\$\$([\s\S]*?)\$\$/)
  assert.ok(fnMatch, 'function body not found')
  assert.match(fnMatch![1], /FROM public\.scorecards sc/i)
  // Configuration-only tables must never be treated as blocking
  // signals by this function -- rounds and side_comps are only ever
  // joined through here to scope scorecards/side_comp_entries to this
  // trip, never checked for their own existence.
  assert.doesNotMatch(fnMatch![1], /EXISTS\s*\(\s*SELECT 1 FROM public\.rounds WHERE trip_id/i)
  assert.doesNotMatch(fnMatch![1], /EXISTS\s*\(\s*SELECT 1 FROM public\.side_comps WHERE trip_id/i)
})

test('trip_has_protected_history checks side_comp_entries and side_comp_lead_changes independently of scorecards', () => {
  const sql = migration()
  assert.match(sql, /FROM public\.side_comp_entries sce/i)
  assert.match(sql, /FROM public\.side_comp_lead_changes lc/i)
})

test('trip_has_protected_history checks moments, event_messages, and published_round_highlights independently', () => {
  const sql = migration()
  assert.match(sql, /FROM public\.moments WHERE trip_id\s*=\s*p_trip_id/i)
  assert.match(sql, /FROM public\.event_messages WHERE trip_id\s*=\s*p_trip_id/i)
  assert.match(sql, /FROM public\.published_round_highlights WHERE trip_id\s*=\s*p_trip_id/i)
})

test('the function is read-only -- contains no INSERT, UPDATE, or DELETE anywhere', () => {
  const sql = migration()
  assert.doesNotMatch(sql, /\bINSERT INTO\b/i)
  assert.doesNotMatch(sql, /\bUPDATE\s+public\./i)
  assert.doesNotMatch(sql, /\bDELETE FROM\b/i)
})

test('DELETE route: the history check occurs before the destructive .delete() call, and rejects on true', () => {
  const ts = readRoute('[tripId]/route.ts')
  const historyCallIndex = ts.indexOf('trip_has_protected_history')
  const deleteCallIndex = ts.indexOf(".from('trips').delete()")
  assert.ok(historyCallIndex > -1, 'history check call not found in DELETE route')
  assert.ok(deleteCallIndex > -1, 'destructive delete call not found')
  assert.ok(historyCallIndex < deleteCallIndex, 'the history check must run before the destructive delete call, not after')
  assert.match(ts, /EVENT_HAS_PLAYER_HISTORY/)
  assert.match(ts, /historyRes\.data === true/)
})

test('DELETE route: the archived-only status check also occurs before the destructive delete call', () => {
  const ts = readRoute('[tripId]/route.ts')
  const statusCheckIndex = ts.indexOf("status !== 'archived'")
  const deleteCallIndex = ts.indexOf(".from('trips').delete()")
  assert.ok(statusCheckIndex > -1 && statusCheckIndex < deleteCallIndex)
})

test('DELETE route: the query is scoped to the single explicit tripId, never a broader match', () => {
  const ts = readRoute('[tripId]/route.ts')
  assert.match(ts, /\.from\('trips'\)\.delete\(\)\.eq\('id', tripId\)/)
})

test('deletion-eligibility route calls the exact same RPC the DELETE route uses as its gate', () => {
  const eligibilityTs = readRoute('[tripId]/deletion-eligibility/route.ts')
  const deleteTs = readRoute('[tripId]/route.ts')
  assert.match(eligibilityTs, /rpc\('trip_has_protected_history'/)
  assert.match(deleteTs, /rpc\('trip_has_protected_history'/)
})

test('deletion-eligibility route never mutates anything -- no insert/update/delete calls', () => {
  const ts = readRoute('[tripId]/deletion-eligibility/route.ts')
  assert.doesNotMatch(ts, /\.insert\(/)
  assert.doesNotMatch(ts, /\.update\(/)
  assert.doesNotMatch(ts, /\.delete\(/)
})

test('deletion-eligibility route enforces organiser-only authorisation before revealing eligibility', () => {
  const ts = readRoute('[tripId]/deletion-eligibility/route.ts')
  assert.match(ts, /organiser_id !== user\.id/)
})
