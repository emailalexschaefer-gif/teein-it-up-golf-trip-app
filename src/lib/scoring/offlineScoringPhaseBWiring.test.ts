import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { interpretSharedDeviceSave } from '../db/sharedDeviceSave'

/**
 * Offline-scoring Phase B — static wiring checks (this repo's convention for
 * client components and route handlers, which cannot run in the sandbox) plus
 * the pure shared-device save interpreter.
 *
 * These prove the glue calls the tested pure modules and that the forbidden
 * things (false "saved" claims, service-worker caching, auto-deleting
 * unresolved scores, extra migrations) are absent. They do NOT prove runtime
 * behaviour on a phone — see the delivery report's device checklist.
 */
const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf8')

const route = read('../../app/api/scores/route.ts')
const dexie = read('../db/dexie.ts')
const sync = read('../db/sync.ts')
const runner = read('../db/syncRunner.ts')
const shell = read('../../app/(app)/trips/[tripId]/rounds/[roundId]/SelfMarkerScoreShell.tsx')
const legacy = read('../../app/(app)/trips/[tripId]/rounds/[roundId]/ScoreSessionShell.tsx')
const banner = read('../../components/scoring/SyncStatusBanner.tsx')
const sw = read('../../../public/sw.js')

// ── D4: shared-device scoring without connectivity ───────────────────────

test('D4: shared-device save — no connection is reported as NOT saved', () => {
  assert.deepEqual(interpretSharedDeviceSave({ threw: true }), { saved: false, reason: 'no connection' })
})

test('D4: shared-device save — only a JSON { ok: true } 2xx counts as saved', () => {
  assert.deepEqual(interpretSharedDeviceSave({ threw: false, status: 200, body: { ok: true, scoreEntryId: 'x' } }), { saved: true })
  for (const bad of [
    { threw: false, status: 200, body: null },
    { threw: false, status: 200, body: {} },
    { threw: false, status: 200, body: { ok: false } },
    { threw: false, status: 200, redirected: true, body: { ok: true } },
    { threw: false, status: 302, body: { ok: true } },
  ]) assert.equal(interpretSharedDeviceSave(bad).saved, false)
  const refused = interpretSharedDeviceSave({ threw: false, status: 403, body: { error: 'This round is not set up for shared-device scoring for you.' } })
  assert.deepEqual(refused, { saved: false, reason: 'This round is not set up for shared-device scoring for you.' })
  assert.equal(interpretSharedDeviceSave({ threw: false, status: 500 }).saved, false)
})

test('D4/D5: the shell never again claims "Saved locally" and never navigates away from a failed save', () => {
  assert.ok(!/Saved locally/.test(shell), 'false "Saved locally" claim must be gone from the main scoring shell')
  assert.ok(!/saved locally — will sync/i.test(legacy), 'and from the legacy shell')
  const adv = shell.slice(shell.indexOf('async function saveAndAdvance'), shell.indexOf('function navigateHole'))
  assert.match(adv, /if \(!outcome\.ok\) \{\s*setSaveFailure\(/)
  assert.ok(adv.indexOf('return') < adv.indexOf('navigateHole(direction)'), 'returns before navigating on failure')
  assert.match(shell, /Continue — I&apos;ve written it on the paper card/)
  assert.match(shell, /Try saving again/)
})

test('D5: on-screen "saved" values are set only AFTER the IndexedDB write commits', () => {
  const body = shell.slice(shell.indexOf('async function saveCurrentHoleData'), shell.indexOf('// The single shared navigation/save function'))
  const q = body.indexOf('await queueScoreEntryBounded({\n          scorecardId: currentMy.id')
  const set = body.indexOf('setMySelf(prev')
  assert.ok(q > 0 && set > q, 'setMySelf must come after the awaited queue write')
  assert.match(body, /catch \{[\s\S]*ok: false, kind: 'local'/)
  assert.ok(!/setPartnerMarker[\s\S]{0,40}\n[\s\S]{0,200}shared-device-score/.test(body.slice(0, body.indexOf('shared-device-score'))), 'partner state is not set before the shared-device request')
})

test('D5: IndexedDB writes in the shells go through the bounded variant (a hung write cannot freeze navigation)', () => {
  assert.ok(!/await queueScoreEntry\(/.test(shell))
  assert.ok(!/await queueScoreEntry\(/.test(legacy))
  assert.match(dexie, /export function queueScoreEntryBounded/)
  assert.match(dexie, /withTimeout\(queueScoreEntry\(entry\), timeoutMs\)/)
})

// ── D1 / D6: server route + client ack ───────────────────────────────────

test('D1: /api/scores decides writes with decideScoreWrite and guards the UPDATE itself with entered_at', () => {
  assert.match(route, /import \{ decideScoreWrite \}/)
  assert.match(route, /decideScoreWrite\(existingForRole\?\.data \?\? null/)
  assert.match(route, /\.lte\('entered_at', incomingEnteredAt\)/)
  assert.ok(!/return NextResponse\.json\(\{ message: 'Already recorded', conflict: true \}, \{ status: 200 \}\)/.test(route), 'the value-blind early return is gone')
})

test('D6: every success answer from /api/scores carries the stored row so the client can verify it', () => {
  assert.match(route, /const ROW_COLUMNS = 'id, scorecard_id, hole_id, capture_role, gross_score, is_no_return, client_id, entered_at, admin_overridden'/)
  assert.match(route, /message: 'Already recorded', conflict: true, duplicate: true/)
  assert.match(route, /stale: true/)
  assert.match(route, /return NextResponse\.json\(inserted\.data, \{ status: 201 \}\)/)
})

test('D6: the upload loop only marks synced after validateScoreAck; res.ok alone is never enough', () => {
  assert.match(runner, /const ack = await validateScoreAck\(res/)
  assert.match(runner, /if \(ack\.kind === 'invalid'\) throw/)
  assert.ok(!/if \(res\.ok\) \{\s*await markEntrySynced/.test(sync), 'the old res.ok -> markEntrySynced shortcut is gone')
})

// ── D2 / D3 / D7 wiring ──────────────────────────────────────────────────

test('D2: startup recovery is wired, and in-flight entries count as pending', () => {
  assert.match(sync, /recoverInterruptedEntries\(true\)/)
  assert.match(sync, /recoverInterrupted: \(\) => recoverInterruptedEntries\(false\)/)
  assert.match(dexie, /getPendingCount[\s\S]{0,200}anyOf\(\['pending', 'error', 'syncing'\]\)/)
})

test('D3: every upload has an AbortController timeout and a dead connection ends the pass', () => {
  assert.match(runner, /new AbortController\(\)/)
  assert.match(runner, /controller\.abort\(\)/)
  assert.match(runner, /signal: controller\.signal/)
  assert.match(runner, /if \(connectivityLost\) break/)
})

test('D7: refused entries are kept, never auto-deleted, and only an explicit action can discard them', () => {
  assert.ok(!/scoreQueue\.clear\(|bulkDelete/.test(dexie))
  const deletes = dexie.match(/scoreQueue\.delete\(/g) ?? []
  assert.equal(deletes.length, 2, 'only: superseded-by-newer-edit in queueScoreEntry, and discardRejectedEntry')
  assert.match(dexie, /export async function discardRejectedEntry[\s\S]*?syncStatus !== 'rejected'\) return false/)
  assert.match(dexie, /export async function requeueRejectedEntry[\s\S]*?syncStatus !== 'rejected'\) return false/)
  assert.match(banner, /isOrganiser && confirmId !== e\.clientId/, 'Discard is organiser-only')
  assert.match(banner, /Yes, discard/, 'and needs explicit confirmation')
})

test('D7: client confirm gate = pending count + THIS round\'s refused entries (not other rounds\')', () => {
  assert.match(shell, /canConfirmRound\(\{ allMatched, pendingCount, rejectedForThisRound: rejectedHere \}\)/)
  assert.match(shell, /const rejectedHere = rejectedEntries\.filter\(e => roundCardIds\.includes\(e\.scorecardId\)\)\.length/)
  assert.match(shell, /rejectedEntries\.some\(e => ids\.includes\(e\.scorecardId\)\)/)
})

// ── D9: draft auto-save ──────────────────────────────────────────────────

test('D9: drafts auto-save after a short settle time, queue-only, via the same bounded queue write', () => {
  const fn = shell.slice(shell.indexOf('async function autosaveDrafts'), shell.indexOf('useEffect(() => {\n    if (!currentMy) return\n    const t = setTimeout'))
  assert.match(shell, /const DRAFT_AUTOSAVE_MS = 800/)
  assert.match(fn, /queueScoreEntryBounded/)
  assert.ok(!/setMySelf|setPartnerMarker|setDraft/.test(fn), 'must not touch displayed state (would re-seed the drafts and could clobber a later tap)')
  assert.match(fn, /!d\.sharedDevice/, 'shared-device partner is not queueable and is not auto-saved')
  assert.match(fn, /if \(confirmingRef\.current\) return/)
  assert.match(shell, /\[draftMyGross, draftMyPickedUp, draftPartnerGross, draftPartnerPickedUp, holeNum\]/)
})

// ── Status UI ────────────────────────────────────────────────────────────

test('status: both shells and the banner derive wording from deriveSyncStatus; the old store-label helper is gone', () => {
  assert.match(shell, /deriveSyncStatus\(\{ online, syncState, pendingCount, rejectedCount, lastFailure \}\)/)
  assert.match(legacy, /deriveSyncStatus\(/)
  assert.match(banner, /deriveSyncStatus\(/)
  assert.ok(!/selectSyncLabel/.test(shell + legacy + read('../../store/syncStore.ts')))
  assert.equal((shell.match(/<SyncStatusBanner /g) ?? []).length, 2, 'scoring screen and Round Summary')
})

// ── Hard boundaries ──────────────────────────────────────────────────────

test('boundary: no service-worker page caching was added (offline page reopening is explicitly deferred)', () => {
  assert.ok(!/navigate/.test(sw), 'sw.js must not handle navigations')
  assert.match(sw, /Every navigation request[\s\S]*passes straight to the network/)
  assert.match(sw, /if \(!isStaticAsset\(url\.pathname\)\) return/)
})

test('boundary: no new database migration was introduced by this package', () => {
  const files = readdirSync(resolve(here, '../../../supabase/migrations'))
  assert.ok(!files.some(f => /offline|sync|score_queue|rejected/i.test(f)), 'no offline-scoring migration')
  assert.ok(!/ALTER TABLE|CREATE TABLE/i.test(route), 'route issues no DDL')
})

test('boundary: round finalisation and close gates are untouched', () => {
  const submit = read('../../app/api/trips/[tripId]/rounds/[roundId]/scorecards/route.ts')
  const close = read('../../app/api/trips/[tripId]/rounds/[roundId]/close/route.ts')
  assert.match(submit, /Waiting on marker entries for one or more holes/)
  assert.match(submit, /Score entry isn't complete/)
  assert.match(close, /checkRoundCompletion/)
})
