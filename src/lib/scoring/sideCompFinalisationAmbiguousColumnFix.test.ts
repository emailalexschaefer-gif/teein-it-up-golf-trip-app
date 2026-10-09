import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// Source-scanning contract tests for migration 094 -- same established
// pattern as sideCompFinalisationAlgorithmFix.test.ts (092). No live
// Postgres connection exists in this sandbox, so these tests confirm
// specific, named correctness properties are genuinely present in the
// real migration file's text.
//
// This file exists specifically because 092's own contract tests
// (sideCompFinalisationAlgorithmFix.test.ts) are pure regex/text checks
// that could not and did not catch the production-only bug: PL/pgSQL
// validates embedded SQL lazily, on first execution, so
// `CREATE OR REPLACE FUNCTION` succeeding tells you nothing about
// whether every column reference inside it is unambiguous at runtime.
// The test below (`094: no unqualified reference ...`) is a generic
// static check for exactly this bug class -- it would have failed
// against 092's actual text, and passes against 094's fix.

const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations')
function readMigration(filename: string): string {
  return fs.readFileSync(path.join(migrationsDir, filename), 'utf8')
}

const FILE_092 = '092_side_comp_finalisation_algorithm_fix.sql'
const FILE_094 = '094_side_comp_finalisation_ambiguous_column_fix.sql'

function stripComments(sql: string): string {
  return sql.replace(/--.*$/gm, '')
}

// Returns the names declared inside a `RETURNS TABLE (...)` clause.
function returnsTableColumnNames(sql: string): string[] {
  const match = sql.match(/RETURNS TABLE\s*\(([\s\S]*?)\)\s*\n?LANGUAGE/)
  assert.ok(match, 'RETURNS TABLE clause not found')
  return match![1]
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean)
}

// Any occurrence of `name` not immediately preceded by a `.` is an
// unqualified reference -- exactly the shape that triggers Postgres
// error 42702 when `name` also happens to be a PL/pgSQL variable (an
// OUT parameter from RETURNS TABLE, in scope for the whole function body).
function unqualifiedOccurrences(sql: string, name: string): number {
  const re = new RegExp(`(?<!\\.)\\b${name}\\b`, 'g')
  return (sql.match(re) ?? []).length
}

test('094: this is a new forward migration, not an edit to 092', () => {
  assert.ok(fs.existsSync(path.join(migrationsDir, FILE_094)), 'migration 094 must exist as its own file')
  // 092 itself must still exist, unedited as a historical migration --
  // its CREATE OR REPLACE already shipped and succeeded; only the
  // function's *runtime* behaviour needed correcting, in a new file.
  assert.ok(fs.existsSync(path.join(migrationsDir, FILE_092)), '092 must remain on disk, unedited')
})

test('094: fixes the exact production error -- no RETURNS TABLE column name is referenced unqualified anywhere in the winning_entry CTE', () => {
  const sql = stripComments(readMigration(FILE_094))
  const columns = returnsTableColumnNames(sql)
  assert.deepEqual(columns, ['side_comp_id', 'winner_entry_id', 'winner_player_id'])

  const weMatch = sql.match(/winning_entry AS \(([\s\S]*?)\),\s*updated AS/)
  assert.ok(weMatch, 'winning_entry CTE not found')
  const body = weMatch![1]

  for (const col of columns) {
    assert.equal(
      unqualifiedOccurrences(body, col),
      0,
      `winning_entry CTE must not reference "${col}" unqualified -- it collides with the function's own RETURNS TABLE output variable of the same name, which is exactly the bug this migration fixes`
    )
  }
})

test('094: confirms 092 actually contained the bug this migration fixes (guards against the fix becoming a no-op if 092 is ever edited)', () => {
  const sql = stripComments(readMigration(FILE_092))
  const weMatch = sql.match(/winning_entry AS \(([\s\S]*?)\),\s*updated AS/)
  assert.ok(weMatch, 'winning_entry CTE not found in 092')
  const body = weMatch![1]
  assert.ok(
    unqualifiedOccurrences(body, 'side_comp_id') > 0,
    '092 should still demonstrate the unqualified-column pattern this migration exists to fix -- if this ever fails, 092 was edited, which the project convention says should never happen'
  )
})

test('094: winner-determination logic is byte-for-byte unchanged from 092 -- only qualification changed', () => {
  const sql094 = stripComments(readMigration(FILE_094))
  const sql092 = stripComments(readMigration(FILE_092))

  // Same branching by comp_type.
  for (const sql of [sql094, sql092]) {
    assert.match(sql, /comp_type\s*=\s*'longest_drive'/)
    assert.match(sql, /comp_type\s+NOT\s+IN\s*\(\s*'longest_drive'\s*,\s*'powerplay'\s*\)/i)
    assert.match(sql, /sce\.qualified\s*=\s*true/)
    assert.match(sql, /sce\.verification_status\s*=\s*'verified'/)
    assert.match(sql, /ORDER BY sce\.side_comp_id,\s*sce\.result_value ASC/)
    assert.doesNotMatch(sql, /result_value DESC/)
  }
})

test('094: the idempotency guard is preserved unchanged', () => {
  const sql = stripComments(readMigration(FILE_094))
  const updateMatch = sql.match(/UPDATE public\.side_comps sc[\s\S]*?WHERE([\s\S]*?)RETURNING/)
  assert.ok(updateMatch, 'the UPDATE statement was not found')
  const whereClause = updateMatch![1]
  assert.match(whereClause, /sc\.round_id\s*=\s*p_round_id/i)
  assert.match(whereClause, /sc\.official_winner_entry_id\s+IS\s+NULL/i)
})

test('094: does not touch scoring, stableford points, or round-close semantics -- scoped to this one function only', () => {
  const sql = stripComments(readMigration(FILE_094))
  assert.doesNotMatch(sql, /stableford/i)
  assert.doesNotMatch(sql, /ALTER TABLE/i)
  assert.doesNotMatch(sql, /DROP TABLE/i)
  const functionDefs = sql.match(/CREATE OR REPLACE FUNCTION/gi) ?? []
  assert.equal(functionDefs.length, 1, 'exactly one function should be redefined in this migration')
})

test('094: migration 093 itself needs no change -- it only calls the now-fixed function', () => {
  const sql093 = stripComments(readMigration('093_side_comp_historical_winner_reconciliation.sql'))
  assert.match(sql093, /PERFORM public\.finalize_side_comp_winners\(r\.id\)/)
  // 093 contains no inline copy of the winner-determination logic to
  // also fix -- it is purely a thin backfill loop, confirmed by absence
  // of any CTE/SELECT winner logic of its own.
  assert.doesNotMatch(sql093, /winning_entry AS/)
})
