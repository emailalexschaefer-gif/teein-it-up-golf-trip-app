// Field-test bug #2: "Could not release this round. Nothing was changed." -- diagnosis pins.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const route = read('src/app/api/trips/[tripId]/rounds/[roundId]/release/route.ts')

test('a rejected chat announcement (23514) is reported as an outdated chat schema, not a retry-able generic error', () => {
  assert.match(route, /rpc\.error\.code === '23514'/)
  assert.match(route, /chat_schema_outdated/)
  assert.match(route, /migration 102/)
  assert.doesNotMatch(route, /apply migration 029/)
})
test('every other release failure carries a SQLSTATE reference and is logged with code, message, details and hint', () => {
  assert.match(route, /\(ref \$\{rpc\.error\.code \?\? 'unknown'\}\)/)
  assert.match(route, /console\.error\('\[release\] rpc failed', \{ roundId, code: rpc\.error\.code, message: rpc\.error\.message, details: rpc\.error\.details, hint: rpc\.error\.hint \}\)/)
})
test('failure is never reported as success and never falls back to another release path', () => {
  const i = route.indexOf("if (rpc.error)")
  const block = route.slice(i, route.indexOf('const out = rpc.data'))
  assert.doesNotMatch(block, /setup_released|\.update\(|\.insert\(|from\('scorecards'\)/)
  assert.match(route, /MIGRATION_MISSING, code: 'migration_missing' \}, \{ status: 503 \}/)
})
test('preflight check 33 fails when the chat recipient_type constraint does not allow all', () => {
  const sql = read('supabase/preflight/101_preflight.sql')
  assert.match(sql, /SELECT 33, 'prereq 102: event_messages recipient_type CHECKs/)
  assert.match(sql, /NOT ILIKE '%''all''%'\) THEN 'FAIL'/)
})
test('SQL reproduction test exists: stale constraint rolls the release back; 9-hole / hole-10 / two-player is fine', () => {
  const t = read('supabase/tests/101_stale_chat_constraint.test.sql')
  assert.match(t, /starting_hole_number\) VALUES \(r1,t,'Round 1',current_date,'upcoming',9,10\)/)
  assert.match(t, /EXCEPTION WHEN check_violation/)
})
test('migration 102 replaces BOTH stale chat constraints, transactionally, widening only, with the group/player rules intact', () => {
  const sql = read('supabase/migrations/102_event_messages_recipient_all_event.sql')
  const body = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  assert.match(body, /^\s*BEGIN;/m)
  assert.match(body, /COMMIT;\s*$/)
  assert.match(body, /DROP CONSTRAINT IF EXISTS event_messages_recipient_type_check/)
  assert.match(body, /DROP CONSTRAINT IF EXISTS event_messages_recipient_consistency_check/)
  assert.match(body, /CHECK \(recipient_type IN \('all', 'event', 'group', 'player'\)\)/)
  assert.match(body, /recipient_type IN \('all', 'event'\) AND recipient_group_id IS NULL AND recipient_user_id IS NULL/)
  assert.match(body, /recipient_type = 'group'\s+AND recipient_group_id IS NOT NULL AND recipient_user_id IS NULL/)
  assert.match(body, /recipient_type = 'player' AND recipient_user_id IS NOT NULL AND recipient_group_id IS NULL/)
  // never touches data, policies, other tables, or the message_type constraint
  assert.doesNotMatch(body, /\b(UPDATE|DELETE|INSERT|TRUNCATE|DROP TABLE|DROP POLICY|CREATE POLICY|message_type)\b/i)
  assert.doesNotMatch(body, /ALTER TABLE (?!public\.event_messages)/)
})
test('no user-facing text or preflight guidance still tells the operator to apply 029 for the release failure', () => {
  const pf = read('supabase/preflight/101_preflight.sql')
  assert.doesNotMatch(pf, /apply migration 029/)
  assert.match(pf, /apply migration 102/)
  assert.doesNotMatch(route, /apply migration 029/)
})
