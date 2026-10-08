import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// Source-scanning contract tests, same established pattern as
// sideCompWinnerHardening.test.ts / sideCompFinalisationAlgorithmFix.test.ts
// -- no live Postgres connection exists in this environment.

const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations')
function readMigration(filename: string): string {
  return fs.readFileSync(path.join(migrationsDir, filename), 'utf8')
}

const FILE = '093_side_comp_historical_winner_reconciliation.sql'

test('093: exists as its own new forward migration, not an edit to any historical one', () => {
  assert.ok(fs.existsSync(path.join(migrationsDir, FILE)))
  // 080's own original backfill block must still exist verbatim.
  const historical080 = readMigration('080_side_comp_official_winners.sql')
  assert.match(historical080, /DO \$\$[\s\S]*FOR r IN SELECT id FROM public\.rounds WHERE status = 'completed' LOOP[\s\S]*PERFORM public\.finalize_side_comp_winners\(r\.id\)/)
})

test('093: reuses finalize_side_comp_winners() -- does not define a second winner-selection implementation', () => {
  const sql = readMigration(FILE).replace(/--.*$/gm, '')
  assert.match(sql, /PERFORM public\.finalize_side_comp_winners\(r\.id\)/)
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION/i)
  assert.doesNotMatch(sql, /UPDATE public\.side_comps/i) // no direct write -- only via the function call
})

test('093: scoped to completed rounds only, matching 080\'s own established backfill condition exactly', () => {
  const sql = readMigration(FILE).replace(/--.*$/gm, '')
  assert.match(sql, /SELECT id FROM public\.rounds WHERE status = 'completed'/)
})

test('093: never reopens a round, never touches scores or side_comp_entries, never alters any table', () => {
  const sql = readMigration(FILE).replace(/--.*$/gm, '')
  assert.doesNotMatch(sql, /UPDATE public\.rounds/i)
  assert.doesNotMatch(sql, /side_comp_entries/i)
  assert.doesNotMatch(sql, /score_entries/i)
  assert.doesNotMatch(sql, /ALTER TABLE/i)
  assert.doesNotMatch(sql, /DROP TABLE/i)
})
