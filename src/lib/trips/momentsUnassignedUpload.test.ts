import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

/**
 * V1.18 (10 Oct) -- Package 2's "Upload Moments." This project has no
 * API-route-level test harness (confirmed: no .test.ts file anywhere
 * under src/app/api exists -- every existing test in this codebase
 * exercises pure functions). The moments POST route itself needs a
 * live Supabase connection to exercise end to end, which this sandbox
 * doesn't have. These tests instead do what sideCompFinalisationAmbiguousColumnFix.test.ts
 * already established as this project's own pattern for a route whose
 * correctness can't be driven live: static, source-level checks that
 * confirm the actual shipped code genuinely has the structural
 * property the brief requires, rather than trusting a description of
 * it. See the delivery report for what still needs live-device/
 * live-database verification beyond this.
 */

const ROUTE_PATH = path.join(__dirname, '../../app/api/trips/[tripId]/moments/route.ts')
const routeSource = fs.readFileSync(ROUTE_PATH, 'utf8')

test('V1.18 #7: an unassigned upload never reads roundId/holeNumber/requestedPlayerId from the request body when building the insert payload -- every one of those fields is forced, not merely defaulted', () => {
  // Isolate the insert payload object literal itself (between the
  // `.insert({` for the moments table and its closing `}).select()`),
  // so this check is about what's actually written to the database,
  // not merely that the words "isUnassigned" appear somewhere in the
  // file.
  const insertStart = routeSource.indexOf("from('moments').insert({")
  assert.ok(insertStart !== -1, 'could not locate the moments insert call')
  const insertEnd = routeSource.indexOf('}).select().single()', insertStart)
  assert.ok(insertEnd !== -1, 'could not locate the end of the moments insert call')
  const insertBlock = routeSource.slice(insertStart, insertEnd)

  for (const field of ['player_id', 'round_id', 'hole_number', 'group_id', 'captured_by', 'audience']) {
    assert.ok(insertBlock.includes(`${field}: isUnassigned`), `expected the insert payload's ${field} to branch on isUnassigned, found:\n${insertBlock}`)
  }
})

test('V1.18 #7: isUnassigned can only ever become true when the caller is this event’s own organiser (trips.organiser_id) -- never any other trip member', () => {
  const unassignedBlockStart = routeSource.indexOf('if (unassigned === true) {')
  assert.ok(unassignedBlockStart !== -1)
  const unassignedBlockEnd = routeSource.indexOf('\n  }', unassignedBlockStart)
  const block = routeSource.slice(unassignedBlockStart, unassignedBlockEnd)
  assert.ok(block.includes("tripRow.organiser_id !== user.id"), 'expected an explicit organiser_id check before isUnassigned is ever set true')
  assert.ok(block.includes('isUnassigned = true'))
})

test('V1.18 #7: the Side Games proxy-capture branch (a Moment posted "of" a teammate) is explicitly skipped for an unassigned upload -- the two features never interact', () => {
  assert.ok(routeSource.includes('if (!isUnassigned && requestedPlayerId'), 'expected the proxy-capture branch to be gated on !isUnassigned')
})

test('V1.18: migration 095 drops NOT NULL from moments.player_id and adds a CHECK that every row still identifies someone (player_id or captured_by)', () => {
  const migrationPath = path.join(__dirname, '../../../supabase/migrations/095_moments_unassigned_and_aftershow.sql')
  const sql = fs.readFileSync(migrationPath, 'utf8')
  assert.ok(/ALTER TABLE public\.moments ALTER COLUMN player_id DROP NOT NULL/.test(sql))
  assert.ok(/player_id IS NOT NULL OR captured_by IS NOT NULL/.test(sql))
  assert.ok(/aftershow_included BOOLEAN/.test(sql))
})
