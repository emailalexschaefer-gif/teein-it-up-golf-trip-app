import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * P0 bug-fix package (7 Sep), regression coverage -- "Side-game claims
 * fail in 1 Digital + 1 Paper mode."
 *
 * No live Postgres connection exists in this sandbox, so the actual
 * INSERT/constraint-violation behaviour cannot be executed here. This
 * instead verifies the actual thing that broke, directly in the
 * deployed SQL text: the CHECK constraint on
 * side_comp_entries.verifier_source must allow every value
 * resolve_side_comp_verifier() can actually return -- a future
 * migration adding a new verifier tier without updating this
 * constraint in the same pass would reproduce exactly this bug again,
 * and this test is what would catch it.
 */

function findLatestMigrationMatching(pattern: RegExp): { filename: string; body: string } | null {
  const migrationsDir = join(process.cwd(), 'supabase/migrations')
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
  let latest: { filename: string; body: string } | null = null
  for (const filename of files) {
    const content = readFileSync(join(migrationsDir, filename), 'utf-8')
    if (!pattern.test(content)) continue
    latest = { filename, body: content }
  }
  return latest
}

/**
 * Strips SQL line comments before pattern-matching. Necessary here
 * specifically: migration 076's own explanatory header quotes the OLD,
 * broken constraint text verbatim as part of describing the bug it
 * fixes -- a naive search over the raw file would find that quoted,
 * commented-out reference instead of the real, executable
 * ADD CONSTRAINT statement at the bottom of the file. This is a
 * genuine gap this test itself had on first write, caught by running
 * it and reading the actual failure rather than assuming the test was
 * correct.
 */
function stripSqlComments(sql: string): string {
  return sql.split('\n').map(line => {
    const idx = line.indexOf('--')
    return idx === -1 ? line : line.slice(0, idx)
  }).join('\n')
}

test('every verifier_source value resolve_side_comp_verifier() can return is allowed by side_comp_entries\u2019 own CHECK constraint', () => {
  const verifierFn = findLatestMigrationMatching(/CREATE OR REPLACE FUNCTION public\.resolve_side_comp_verifier\s*\(/i)
  assert.ok(verifierFn, 'No migration defining resolve_side_comp_verifier() was found.')

  // Every literal ::TEXT-tagged verifier_source value the function can
  // actually return, extracted directly from its own RETURN QUERY
  // statements -- not a hand-maintained list that could itself drift
  // out of sync with the real function.
  const returnedValues = [...stripSqlComments(verifierFn!.body).matchAll(/'([a-z_]+)'::TEXT/g)].map(m => m[1])
  assert.ok(returnedValues.length >= 4, `${verifierFn!.filename}: expected at least 4 distinct returned verifier_source literals, found ${returnedValues.length}`)

  const constraintMigration = findLatestMigrationMatching(/verifier_source\s+IN\s*\(/i)
  assert.ok(constraintMigration, 'No migration defining the verifier_source CHECK constraint was found.')

  const constraintMatch = stripSqlComments(constraintMigration!.body).match(/verifier_source\s+IN\s*\(([^)]+)\)/i)
  assert.ok(constraintMatch, `${constraintMigration!.filename}: could not locate the verifier_source IN (...) constraint list`)
  const allowedValues = constraintMatch![1].split(',').map(s => s.trim().replace(/^'|'$/g, ''))

  for (const returned of new Set(returnedValues)) {
    assert.ok(
      allowedValues.includes(returned),
      `verifier_source value '${returned}' (returned by ${verifierFn!.filename}) is not in the allowed list [${allowedValues.join(', ')}] from ${constraintMigration!.filename} -- this is exactly the bug that broke every shared-device Side Game claim.`,
    )
  }
})

test('the CHECK constraint specifically allows \u2019shared_device_partner\u2019 -- the exact value that was missing', () => {
  const constraintMigration = findLatestMigrationMatching(/verifier_source\s+IN\s*\(/i)
  assert.ok(constraintMigration)
  assert.match(
    constraintMigration!.body, /'shared_device_partner'/,
    `${constraintMigration!.filename}: the verifier_source constraint does not list 'shared_device_partner' -- every shared-device Side Game claim (self or proxy) will fail to save.`,
  )
})
