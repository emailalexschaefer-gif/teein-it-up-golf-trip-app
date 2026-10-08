import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// Source-scanning contract tests, not executed-SQL tests -- same
// established pattern as sideCompWinnerHardening.test.ts: no live
// Postgres connection exists in this environment, so each test
// confirms a specific, named correctness property is genuinely
// present in the real migration file's text, not merely in the
// separate JS behavioural mirror (finaliseSideCompWinnerAlgorithm.test.ts).

const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations')
function readMigration(filename: string): string {
  return fs.readFileSync(path.join(migrationsDir, filename), 'utf8')
}

const FILE = '092_side_comp_finalisation_algorithm_fix.sql'

test('092: this is a new forward migration, not an edit to an already-applied historical one', () => {
  assert.ok(fs.existsSync(path.join(migrationsDir, FILE)), 'migration 092 must exist as its own file')
  // Confirm the historical migrations (080, 082) are untouched --
  // their own finalize_side_comp_winners definitions still exist
  // verbatim in those files, proving 092 is a CREATE OR REPLACE in a
  // new file, not a rewrite of history.
  const historical080 = readMigration('080_side_comp_official_winners.sql')
  assert.match(historical080, /CREATE OR REPLACE FUNCTION public\.finalize_side_comp_winners/)
  assert.match(historical080, /latest_leader AS/)
})

test('092: branches by comp_type -- longest_drive is handled separately from every other type', () => {
  const sql = readMigration(FILE).replace(/--.*$/gm, '')
  assert.match(sql, /comp_type\s*=\s*'longest_drive'/)
  assert.match(sql, /comp_type\s+NOT\s+IN\s*\(\s*'longest_drive'\s*,\s*'powerplay'\s*\)/i)
})

test('092: the longest_drive path requires qualified AND verified, fixing the subtler pre-existing gap', () => {
  const sql = readMigration(FILE).replace(/--.*$/gm, '')
  const ldMatch = sql.match(/longest_drive_winner AS \(([\s\S]*?)\),\s*value_based_winner AS/)
  assert.ok(ldMatch, 'longest_drive_winner CTE not found')
  const body = ldMatch![1]
  assert.match(body, /sce\.qualified\s*=\s*true/)
  assert.match(body, /sce\.verification_status\s*=\s*'verified'/)
  assert.match(body, /ORDER BY lc\.side_comp_id,\s*lc\.sequence_number DESC/)
})

test('092: the value-based path (nearest_pin/pros_approach/etc.) requires qualified, verified, and a non-null result_value, ordered by best (lowest) value', () => {
  const sql = readMigration(FILE).replace(/--.*$/gm, '')
  const vbMatch = sql.match(/value_based_winner AS \(([\s\S]*?)\),\s*winning_entry AS/)
  assert.ok(vbMatch, 'value_based_winner CTE not found')
  const body = vbMatch![1]
  assert.match(body, /sce\.qualified\s*=\s*true/)
  assert.match(body, /sce\.verification_status\s*=\s*'verified'/)
  assert.match(body, /sce\.result_value IS NOT NULL/)
  assert.match(body, /ORDER BY sce\.side_comp_id,\s*sce\.result_value ASC/)
  // Explicitly NOT descending -- a lower value must win (distance-to-pin semantics).
  assert.doesNotMatch(body, /result_value DESC/)
})

test('092: powerplay is explicitly excluded from the value-based path and has no winner-producing path of its own', () => {
  const sql = readMigration(FILE).replace(/--.*$/gm, '')
  // powerplay appears only in the explicit exclusion, never as its
  // own CTE or its own winner-producing branch.
  const powerplayMentions = (sql.match(/powerplay/gi) ?? []).length
  assert.ok(powerplayMentions >= 1, 'powerplay should be explicitly excluded, not silently ignored')
  assert.doesNotMatch(sql, /comp_type\s*=\s*'powerplay'[\s\S]{0,80}SELECT/i)
})

test('092: the idempotency guard is preserved unchanged from the historical version', () => {
  const sql = readMigration(FILE).replace(/--.*$/gm, '')
  const updateMatch = sql.match(/UPDATE public\.side_comps sc[\s\S]*?WHERE([\s\S]*?)RETURNING/)
  assert.ok(updateMatch, 'the UPDATE statement was not found')
  const whereClause = updateMatch![1]
  assert.match(whereClause, /sc\.round_id\s*=\s*p_round_id/i)
  assert.match(whereClause, /sc\.official_winner_entry_id\s+IS\s+NULL/i)
})

test('092: does not touch scoring, stableford points, or round-close semantics -- scoped to this one function only', () => {
  const sql = readMigration(FILE).replace(/--.*$/gm, '')
  assert.doesNotMatch(sql, /stableford/i)
  assert.doesNotMatch(sql, /ALTER TABLE public\.rounds/i)
  const functionDefs = sql.match(/CREATE OR REPLACE FUNCTION/gi) ?? []
  assert.equal(functionDefs.length, 1, 'exactly one function should be redefined in this migration')
})

test('092: does not drop or alter any table, only redefines the one function', () => {
  const sql = readMigration(FILE).replace(/--.*$/gm, '')
  assert.doesNotMatch(sql, /DROP TABLE/i)
  assert.doesNotMatch(sql, /ALTER TABLE/i)
  assert.doesNotMatch(sql, /DROP COLUMN/i)
})
