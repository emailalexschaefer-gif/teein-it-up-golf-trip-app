import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// P0 production recovery (9 Sep) -- source-scanning contract tests
// against the real corrective migration, since no live Postgres
// connection exists in this environment to actually fire the
// trigger. Each test targets one specific property from the incident
// report's own "tests required" list.

const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations')
function readMigration(filename: string): string {
  return fs.readFileSync(path.join(migrationsDir, filename), 'utf8')
}
function stripComments(sql: string): string {
  return sql.replace(/--.*$/gm, '')
}

test('the fixed trigger function subtracts exactly the two approved system fields, nothing else', () => {
  const sql = stripComments(readMigration('083_side_comp_lock_allows_result_fields.sql'))
  const fnMatch = sql.match(/enforce_round_config_lock\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/)
  assert.ok(fnMatch, 'enforce_round_config_lock function body not found')
  const body = fnMatch![1]
  assert.match(body, /to_jsonb\(NEW\)\s*-\s*'official_winner_entry_id'\s*-\s*'finalised_at'/i)
  assert.match(body, /to_jsonb\(OLD\)\s*-\s*'official_winner_entry_id'\s*-\s*'finalised_at'/i)
})

test('a configuration-only change (nothing exempted) still falls through to the exception on a started round', () => {
  const sql = stripComments(readMigration('083_side_comp_lock_allows_result_fields.sql'))
  const fnMatch = sql.match(/enforce_round_config_lock\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/)
  assert.ok(fnMatch, 'function body not found')
  const body = fnMatch![1]
  // The exemption is inside an IF ... THEN RETURN NEW; END IF; block --
  // confirms the RAISE EXCEPTION statement still exists UNCONDITIONALLY
  // reachable after it, i.e. the exemption is an early-return, not a
  // replacement of the whole lock.
  const exemptionIndex = body.indexOf('RETURN NEW;')
  const raiseIndex = body.indexOf('RAISE EXCEPTION')
  assert.ok(exemptionIndex > -1 && raiseIndex > -1, 'expected both an early RETURN NEW and a RAISE EXCEPTION in the same function')
  assert.ok(raiseIndex > exemptionIndex, 'RAISE EXCEPTION must still be reachable for anything that is not a pure result-field update')
})

test('the exemption only ever applies to UPDATE, never INSERT -- adding a new Side Game after round start must still fail', () => {
  const sql = stripComments(readMigration('083_side_comp_lock_allows_result_fields.sql'))
  const fnMatch = sql.match(/enforce_round_config_lock\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/)
  assert.ok(fnMatch, 'function body not found')
  assert.match(fnMatch![1], /TG_OP\s*=\s*'UPDATE'/i)
})

test('the trigger is redeclared as INSERT OR UPDATE only, matching migration 045s existing narrowed scope -- DELETE is not reintroduced', () => {
  const sql = stripComments(readMigration('083_side_comp_lock_allows_result_fields.sql'))
  const triggerMatch = sql.match(/CREATE TRIGGER side_comps_lock_after_start([\s\S]*?)FOR EACH ROW/)
  assert.ok(triggerMatch, 'trigger declaration not found')
  assert.match(triggerMatch![1], /BEFORE INSERT OR UPDATE ON public\.side_comps/i)
  assert.doesNotMatch(triggerMatch![1], /DELETE/i)
})

test('finalize_side_comp_winners retains its idempotency guard, unchanged, in the recovery migration', () => {
  const sql = stripComments(readMigration('083_side_comp_lock_allows_result_fields.sql'))
  const updateMatch = sql.match(/UPDATE public\.side_comps sc[\s\S]*?WHERE([\s\S]*?)RETURNING/)
  assert.ok(updateMatch, 'the UPDATE statement was not found')
  assert.match(updateMatch![1], /sc\.official_winner_entry_id\s+IS\s+NULL/i)
})

test('every schema statement in the recovery migration is idempotent (safe regardless of 080s partial-application state)', () => {
  const sql = stripComments(readMigration('083_side_comp_lock_allows_result_fields.sql'))
  assert.match(sql, /ADD COLUMN IF NOT EXISTS official_winner_entry_id/i)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS finalised_at/i)
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.finalize_side_comp_winners/i)
  assert.match(sql, /DROP TRIGGER IF EXISTS side_comps_lock_after_start/i)
})

test('082s integrity trigger and this fix compose correctly -- a wrong-competition entry is still rejected by 082 even once 083 is applied', () => {
  // 083 only changes enforce_round_config_lock(), never touches
  // enforce_side_comp_winner_integrity() (082) at all -- confirmed by
  // absence, not just assumed. Both are independent BEFORE triggers on
  // the same table; a write must pass both to succeed, so relaxing the
  // config lock for result fields cannot weaken the separate
  // cross-competition integrity check 082 already established.
  const sql083 = stripComments(readMigration('083_side_comp_lock_allows_result_fields.sql'))
  assert.doesNotMatch(sql083, /enforce_side_comp_winner_integrity/i)

  const sql082 = stripComments(readMigration('082_side_comp_winner_hardening.sql'))
  assert.match(sql082, /CREATE TRIGGER side_comps_winner_integrity/i)
})
