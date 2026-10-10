import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

/**
 * V1.18 pre-deployment verification -- nullable-player_id compatibility
 * audit. Found during the audit: the chat feed's enrichment query
 * (GET /api/trips/[tripId]/messages) built `subjectIds` from every
 * fetched Moment's `player_id` and passed it straight into
 * `.in('id', subjectIds)` against `profiles`. An organiser's unassigned
 * event upload (migration 095) has `player_id = null`, so that array
 * could contain a literal `null` entry -- a genuine behaviour change
 * introduced by the nullable column, not a pre-existing property of
 * this file. Fixed by filtering nulls out before building subjectIds,
 * and by checking `moment.player_id` explicitly before using it as a
 * map key when resolving `momentPlayerName`.
 *
 * Same reasoning as momentsUnassignedUpload.test.ts for why this is a
 * static, source-level check rather than a live-request test: this
 * project has no API-route-level test harness and the route needs a
 * real Supabase connection to exercise end to end.
 */

const ROUTE_PATH = path.join(__dirname, '../../app/api/trips/[tripId]/messages/route.ts')
const routeSource = fs.readFileSync(ROUTE_PATH, 'utf8')

test('V1.18 nullable-player_id audit: subjectIds filters out null player_id entries before being passed to .in(\'id\', subjectIds)', () => {
  const subjectIdsStart = routeSource.indexOf('const subjectIds =')
  assert.ok(subjectIdsStart !== -1, 'could not locate the subjectIds computation')
  const subjectIdsEnd = routeSource.indexOf('\n\n', subjectIdsStart)
  const block = routeSource.slice(subjectIdsStart, subjectIdsEnd)
  assert.ok(
    /\.filter\(\s*\(id\):\s*id is string\s*=>\s*id !== null\s*\)/.test(block),
    `expected subjectIds to filter out null player_id entries before the nameBySenderId check, found:\n${block}`
  )
})

test('V1.18 nullable-player_id audit: momentPlayerName resolution checks moment.player_id is non-null before using it as a map key', () => {
  assert.ok(
    routeSource.includes('moment && moment.player_id ? (nameBySenderId.get(moment.player_id) ?? null) : null'),
    'expected momentPlayerName to explicitly guard on moment.player_id before the map lookup'
  )
})

test('V1.18 nullable-player_id audit: the moments enrichment query\'s local type annotations treat player_id as nullable, not string', () => {
  assert.ok(
    routeSource.includes('player_id: string | null; image_path: string; hole_number: number | null; caption: string | null }>('),
    'expected the momentById Map type annotation to type player_id as string | null'
  )
})
