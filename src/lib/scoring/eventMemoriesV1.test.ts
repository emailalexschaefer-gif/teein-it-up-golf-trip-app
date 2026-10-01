import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// Event Memories V1 (10 Sep) -- source-scanning contract tests against
// the real routes and migration, since no live Postgres/Storage
// connection exists in this environment. Each test targets a specific
// safety or correctness property from the brief's own Part 24 list.

const tripsApiDir = path.join(process.cwd(), 'src', 'app', 'api', 'trips')
function readRoute(relativePath: string): string {
  return fs.readFileSync(path.join(tripsApiDir, relativePath), 'utf8')
}
function readMigration(filename: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'supabase', 'migrations', filename), 'utf8')
}
// V1.1 Phase 2 (11 Sep) -- the actual data-fetching this file's own
// tests check (memories query, Side Game winners, highlights,
// deferred champion) was extracted out of memory-manifest/route.ts
// into this shared function, so the export route could read the same
// canonical data without duplicating it. The behaviour these tests
// verify is unchanged -- only its file moved -- so the tests now read
// from where the logic actually lives, not where it used to.
function readEventMemoryData(): string {
  return fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'trips', 'eventMemoryData.ts'), 'utf8')
}

test('is_event_favourite: additive column, NOT NULL DEFAULT false -- existing moments are unaffected', () => {
  const sql = readMigration('085_moments_event_favourite.sql')
  assert.match(sql, /ADD COLUMN IF NOT EXISTS is_event_favourite BOOLEAN NOT NULL DEFAULT false/)
})

test('manifest route: membership is required to read the manifest -- not organiser-only, matching final-results own rule', () => {
  const ts = readRoute('[tripId]/memory-manifest/route.ts')
  assert.match(ts, /trip_members['")\s]*\)\.select\('role'\)/)
  assert.match(ts, /Not a trip member/)
})

test('manifest route: memories are read from a single, unfiltered query scoped to trip_id -- one row per moment, no fan-out join that could duplicate a row', () => {
  const ts = readEventMemoryData()
  const momentsQueryMatch = ts.match(/momentsRes = await admin\.from\('moments'\)[\s\S]*?\.order\([^)]*\)/)
  assert.ok(momentsQueryMatch, 'moments query not found')
  assert.match(momentsQueryMatch![0], /\.eq\('trip_id', tripId\)/)
})

test('manifest route: side game winners are read from official_winner_entry_id, never recomputed from raw entries/lead changes', () => {
  const ts = readEventMemoryData()
  assert.match(ts, /official_winner_entry_id/)
  // V1.1 (11 Sep) correctly added a separate, explicit query against
  // side_comp_lead_changes -- but only for the per-Memory reverse
  // Side Game link (a different concern), never for computing who
  // won. Scoped specifically to the winners computation block itself,
  // not the whole file, so this remains a precise check rather than
  // the overly broad "never appears anywhere" assertion that would
  // have made this test fail on a legitimate, unrelated addition.
  const winnersBlockMatch = ts.match(/const sideGameWinners = sideComps[\s\S]*?\}\)\)/)
  assert.ok(winnersBlockMatch, 'sideGameWinners computation block not found')
  assert.doesNotMatch(winnersBlockMatch![0], /side_comp_lead_changes/)
})

test('manifest route: highlights are read from published_round_highlights, never regenerated from raw scores', () => {
  const ts = readEventMemoryData()
  assert.match(ts, /from\('published_round_highlights'\)/)
  assert.doesNotMatch(ts, /score_entries/)
})

test('manifest route: champion is explicitly deferred (null), not fabricated with a guessed calculation', () => {
  const ts = readEventMemoryData()
  assert.match(ts, /champion:\s*null/)
})

test('favourite route: organiser-only, checked before the write', () => {
  const ts = readRoute('[tripId]/memories/[momentId]/favourite/route.ts')
  const orgCheckIndex = ts.indexOf('organiser_id !== user.id')
  const updateIndex = ts.indexOf(".from('moments')\n    .update(")
  assert.ok(orgCheckIndex > -1, 'organiser check not found')
  assert.ok(updateIndex > -1, 'update call not found')
  assert.ok(orgCheckIndex < updateIndex, 'organiser check must precede the write')
})

test('favourite route: the update is scoped to both momentId AND tripId together -- cannot cross into another trips moment', () => {
  const ts = readRoute('[tripId]/memories/[momentId]/favourite/route.ts')
  const updateBlockMatch = ts.match(/\.update\(\{[\s\S]*?\.maybeSingle\(\)/)
  assert.ok(updateBlockMatch, 'update block not found')
  assert.match(updateBlockMatch![0], /\.eq\('id', momentId\)/)
  assert.match(updateBlockMatch![0], /\.eq\('trip_id', tripId\)/)
})

test('favourite route: the write is a plain boolean assignment -- idempotent by construction, not by extra guard logic', () => {
  const ts = readRoute('[tripId]/memories/[momentId]/favourite/route.ts')
  assert.match(ts, /is_event_favourite:\s*parsed\.data\.favourite/)
})

test('download route: access is derived from the same everyone/group/own-upload rule as Moments own visibility, not organiser-only', () => {
  const ts = readRoute('[tripId]/memories/[momentId]/download/route.ts')
  assert.match(ts, /audience === 'everyone'/)
  assert.match(ts, /player_id === user\.id/)
  assert.match(ts, /audience === 'group'/)
})

test('download route: the moment lookup is scoped to both momentId and tripId -- cannot retrieve another trips photo by id alone', () => {
  const ts = readRoute('[tripId]/memories/[momentId]/download/route.ts')
  const lookupMatch = ts.match(/momentRes = await admin\.from\('moments'\)[\s\S]*?\.maybeSingle\(\)/)
  assert.ok(lookupMatch, 'moment lookup not found')
  assert.match(lookupMatch![0], /\.eq\('id', momentId\)\.eq\('trip_id', tripId\)/)
})

test('download route: returns a signed URL, never a raw/public storage path or a recompressed copy', () => {
  const ts = readRoute('[tripId]/memories/[momentId]/download/route.ts')
  assert.match(ts, /createSignedUrl\(/)
})
