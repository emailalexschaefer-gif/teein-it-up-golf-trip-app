import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Consolidated Test + Fix brief (1 Sep), item 4 regression hardening —
 * "begin_round input/output contract retains group_id."
 *
 * No live Postgres connection exists in this sandbox, so
 * begin_round()'s actual runtime behaviour cannot be executed or
 * asserted on directly. This instead verifies the actual thing that
 * broke: scorecards.group_id was never included in begin_round()'s own
 * INSERT/UPDATE column list, on every version of that function from its
 * introduction through migration 069 — confirmed by direct reading, not
 * assumed. This test finds the MOST RECENT migration that redeclares
 * begin_round() (currently 070) and asserts group_id genuinely appears
 * in both the INSERT column list and the ON CONFLICT ... DO UPDATE SET
 * clause of the scorecards upsert specifically — not just anywhere in
 * the file (the invariant-check section legitimately references
 * group_id via trip_members for unrelated reasons, which would produce
 * a false pass if this only checked "does group_id appear at all").
 *
 * This cannot prove migration 070 has actually been applied to
 * production, or that Postgres executes it as written — only that the
 * fix, once deployed, is genuinely present in the function this app
 * will call, and that a future edit to begin_round() can't silently
 * drop group_id again without this test failing.
 */

function findLatestBeginRoundMigration(): { filename: string; body: string } {
  const migrationsDir = join(process.cwd(), 'supabase/migrations')
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
  let latest: { filename: string; body: string } | null = null

  for (const filename of files) {
    const content = readFileSync(join(migrationsDir, filename), 'utf-8')
    if (!/CREATE OR REPLACE FUNCTION public\.begin_round\s*\(/i.test(content)) continue
    latest = { filename, body: content } // files are sorted, so the last match wins
  }

  if (!latest) throw new Error('No migration defining begin_round() was found.')
  return latest
}

function extractScorecardsUpsertBlock(body: string): string {
  // Isolate just the scorecards INSERT ... ON CONFLICT ... block, not
  // the whole function — the invariant checks further down legitimately
  // reference group_id via trip_members for an unrelated purpose
  // (counting distinct groups processed), which must not satisfy this
  // check.
  const match = body.match(/INSERT INTO public\.scorecards[\s\S]*?ON CONFLICT[\s\S]*?;/i)
  if (!match) throw new Error('Could not locate the scorecards INSERT/ON CONFLICT block in begin_round().')
  return match[0]
}

test('begin_round() writes group_id in both the scorecards INSERT column list and the ON CONFLICT UPDATE clause', () => {
  const { filename, body } = findLatestBeginRoundMigration()
  const upsertBlock = extractScorecardsUpsertBlock(body)

  const insertClause = upsertBlock.match(/INSERT INTO public\.scorecards\s*\(([^)]+)\)/i)
  assert.ok(insertClause, `${filename}: could not find the scorecards INSERT column list`)
  const insertColumns = insertClause![1].split(',').map(c => c.trim().toLowerCase())
  assert.ok(
    insertColumns.includes('group_id'),
    `${filename}: scorecards INSERT column list is missing group_id — got [${insertColumns.join(', ')}]`,
  )

  const updateClause = upsertBlock.match(/DO UPDATE SET([\s\S]*?);/i)
  assert.ok(updateClause, `${filename}: could not find the ON CONFLICT DO UPDATE SET clause`)
  assert.match(
    updateClause![1], /group_id\s*=\s*EXCLUDED\.group_id/i,
    `${filename}: ON CONFLICT DO UPDATE SET does not reassign group_id — a conflicting (re-started) scorecard would keep a stale value`,
  )
})

test('begin_round()\u2019s p_scorecard_data parameter comment documents group_id as an accepted field', () => {
  const { filename, body } = findLatestBeginRoundMigration()
  const paramLine = body.match(/p_scorecard_data\s+JSONB.*$/m)
  assert.ok(paramLine, `${filename}: could not find the p_scorecard_data parameter declaration`)
  assert.match(
    paramLine![0], /group_id/i,
    `${filename}: p_scorecard_data's own doc comment doesn't mention group_id — should stay in sync with what the function actually reads`,
  )
})
