import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { EVENT_TYPE_OPTIONS } from '../../types/app'

/**
 * Priority — Social Golf P0 regression coverage (item 8). Cannot run a
 * real integration test against Postgres from this environment (no
 * database connection available at all in this sandbox), so this
 * verifies the actual thing that broke: the frontend's canonical
 * event-type values and the database's own CHECK constraint drifting
 * apart. Finds the MOST RECENT migration that touches
 * trips.event_type (currently 061, having superseded 036 — this test
 * deliberately doesn't hardcode a migration number, so it keeps working
 * as this list evolves), extracts the exact values from its own SQL
 * text, and asserts they match EVENT_TYPE_OPTIONS exactly — same set,
 * same values, nothing on either side that the other doesn't know
 * about. This is precisely the drift that caused "violates check
 * constraint trips_event_type_check" in production: the code was
 * already correct, the migration already existed and was already
 * correct too, but nothing before this test would ever have failed to
 * catch it not having been actually applied — this test can't catch
 * "wasn't run in Supabase" either (nothing running in this repository
 * can), but it does guarantee the two sides of the contract never
 * silently diverge again going forward.
 */

function findLatestEventTypeMigration(): { filename: string; values: string[] } {
  // process.cwd() rather than __dirname — this file gets compiled to a
  // different location than its source (a build's outDir), so a
  // __dirname-relative path would resolve against the WRONG directory
  // tree. Test runners are invoked from the project root, making
  // process.cwd() the reliable anchor regardless of where the compiled
  // test itself ends up living.
  const migrationsDir = join(process.cwd(), 'supabase/migrations')
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
  let latest: { filename: string; values: string[] } | null = null

  for (const filename of files) {
    const content = readFileSync(join(migrationsDir, filename), 'utf-8')
    if (!/event_type/i.test(content)) continue
    if (!/CHECK\s*\(\s*event_type\s+IN\s*\(/i.test(content)) continue
    const match = content.match(/CHECK\s*\(\s*event_type\s+IN\s*\(([^)]+)\)/i)
    if (!match) continue
    const values = match[1]
      .split(',')
      .map(v => v.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
    latest = { filename, values } // files are sorted, so the last match wins
  }

  if (!latest) throw new Error('No migration defining the trips.event_type CHECK constraint was found.')
  return latest
}

test('EVENT_TYPE_OPTIONS matches the latest event_type CHECK constraint migration exactly', () => {
  const { filename, values: migrationValues } = findLatestEventTypeMigration()
  // Cast to string[] deliberately — EVENT_TYPE_OPTIONS' own values are a
  // narrow union type, but migrationValues comes from parsing raw SQL
  // text (an external, untyped source by nature), so comparing them
  // needs the general string comparison, not the narrow union.
  const frontendValues: string[] = EVENT_TYPE_OPTIONS.map(o => o.value)

  const missingFromMigration = frontendValues.filter(v => !migrationValues.includes(v))
  const missingFromFrontend = migrationValues.filter(v => !frontendValues.includes(v))

  assert.deepEqual(
    missingFromMigration, [],
    `EVENT_TYPE_OPTIONS has values the database constraint in ${filename} does not permit: ${missingFromMigration.join(', ')}`,
  )
  assert.deepEqual(
    missingFromFrontend, [],
    `${filename} permits values the frontend never sends: ${missingFromFrontend.join(', ')} (harmless, but likely dead/stale)`,
  )
})

test('event_type migration values are non-empty and well-formed', () => {
  const { values } = findLatestEventTypeMigration()
  assert.ok(values.length > 0, 'Expected at least one permitted event_type value')
  for (const v of values) {
    assert.match(v, /^[a-z_]+$/, `Unexpected event_type value format: "${v}"`)
  }
})
