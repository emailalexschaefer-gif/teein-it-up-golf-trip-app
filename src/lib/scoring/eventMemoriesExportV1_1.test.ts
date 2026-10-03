import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// Event Memories V1.1 Phase 2 (11 Sep) -- source-scanning contract
// tests for the export route, since streaming a real ZIP from a real
// Storage bucket cannot be exercised in this sandbox (no network, no
// archiver package installed to actually run). Each test targets a
// specific safety property from the brief's own security/testing list.

function readExportRoute(): string {
  return fs.readFileSync(path.join(process.cwd(), 'src', 'app', 'api', 'trips', '[tripId]', 'export', 'route.ts'), 'utf8')
}

test('export is organiser-only, checked before any Memory data is fetched', () => {
  const ts = readExportRoute()
  const orgCheckIndex = ts.indexOf('organiser_id !== user.id')
  const fetchDataIndex = ts.indexOf('fetchEventMemoryData(tripId')
  assert.ok(orgCheckIndex > -1, 'organiser check not found')
  assert.ok(fetchDataIndex > -1, 'data fetch not found')
  assert.ok(orgCheckIndex < fetchDataIndex, 'organiser check must precede fetching the event data')
})

test('export scope is validated against a strict schema -- an unrecognised scope kind is rejected before anything is fetched', () => {
  const ts = readExportRoute()
  assert.match(ts, /z\.discriminatedUnion\('kind'/)
  assert.match(ts, /z\.literal\('all'\)/)
  assert.match(ts, /z\.literal\('favourites'\)/)
  assert.match(ts, /z\.literal\('round'\)/)
  assert.match(ts, /z\.literal\('selected'\)/)
})

test('a client-supplied roundId/momentIds is never used to look up another trip\'s data directly -- it only filters this trip\'s own already-fetched memories', () => {
  const ts = readExportRoute()
  // buildExportManifest (the scope filter) is called with exportMemories,
  // which is itself derived from `data` -- the one fetchEventMemoryData
  // result already scoped to this tripId. There is no second query
  // keyed by roundId or momentIds anywhere in this file.
  assert.doesNotMatch(ts, /\.eq\('id', roundId\)/)
  assert.doesNotMatch(ts, /\.in\('id', momentIds\)/)
  assert.match(ts, /buildExportManifest\(data\.event\.name, scope, exportMemories\)/)
})

test('source Storage objects are only ever read (download), never written, updated, or deleted', () => {
  const ts = readExportRoute()
  assert.match(ts, /storage\.from\('event-moments'\)\.download\(/)
  assert.doesNotMatch(ts, /storage\.from\('event-moments'\)\.upload\(/)
  assert.doesNotMatch(ts, /storage\.from\('event-moments'\)\.remove\(/)
  assert.doesNotMatch(ts, /storage\.from\('event-moments'\)\.update\(/)
})

test('a failed individual photo download is skipped (returns null from the batch), not allowed to abort the entire export', () => {
  const ts = readExportRoute()
  // Structure changed from a simple for-of loop to batched concurrent
  // downloads (Hobby architecture pass) -- the "skip, don't abort"
  // behaviour is now a `return null` inside the batch's own
  // Promise.all map, filtered out afterward with `if (!result) continue`.
  const batchMapMatch = ts.match(/downloaded = await Promise\.all\(batch\.map\(async entry => \{[\s\S]*?\}\)\)/)
  assert.ok(batchMapMatch, 'the batched download map was not found')
  assert.match(batchMapMatch![0], /return null/)
  assert.match(ts, /if \(!result\) continue/)
})

test('the export route reads from fetchEventMemoryData -- the same shared source the manifest route uses, not a second, independent query path', () => {
  const ts = readExportRoute()
  assert.match(ts, /from '@\/lib\/trips\/eventMemoryData'/)
  assert.match(ts, /fetchEventMemoryData\(tripId/)
})

test('the export route skips generating signed URLs it has no use for, since it downloads image bytes directly', () => {
  const ts = readExportRoute()
  assert.match(ts, /generateSignedUrls:\s*false/)
})

test('the response is constructed from a streaming ReadableStream, and the archive is finalised inside an async task that runs independently of returning that response', () => {
  const ts = readExportRoute()
  assert.match(ts, /return new Response\(readable/)
  assert.match(ts, /\(async \(\) => \{[\s\S]*?archive\.finalize\(\)[\s\S]*?\}\)\(\)\.catch/)
})

test('manifest and summary are both scoped to exactly what is in this export, not the whole event\'s full history regardless of scope', () => {
  const ts = readExportRoute()
  assert.match(ts, /exportMemories\.filter\(m => exportResult\.entries\.some\(e => e\.momentId === m\.momentId && !e\.isFavouriteDuplicate\)\)/)
})

test('maxDuration is explicitly set to 60 -- the value valid under both possible Hobby regimes, after 300 was observed to fail the real production build', () => {
  const ts = readExportRoute()
  assert.match(ts, /export const maxDuration = 60/)
})

test('photo downloads are batched (concurrent within a batch), not strictly one-at-a-time, to reduce wall-clock time toward the duration ceiling', () => {
  const ts = readExportRoute()
  assert.match(ts, /const BATCH_SIZE = \d+/)
  assert.match(ts, /await Promise\.all\(batch\.map\(/)
})
