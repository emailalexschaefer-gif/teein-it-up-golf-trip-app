import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { showPartnerPanel, partnerNotStartedNote } from './partnerPresence'

const ROOT = process.cwd()
const shell = readFileSync(join(ROOT, 'src/app/(app)/trips/[tripId]/rounds/[roundId]/SelfMarkerScoreShell.tsx'), 'utf8')

test('partner panel follows the LIVE marked scorecard (waiting screen clears when the partner appears)', () => {
  const base = { requiresMarker: true, isSharedDeviceScoring: false, partnerName: 'TEST' }
  assert.equal(showPartnerPanel({ ...base, liveMarkedPresent: false }), false)
  assert.equal(showPartnerPanel({ ...base, liveMarkedPresent: true }), true)
  assert.equal(showPartnerPanel({ ...base, liveMarkedPresent: true, partnerName: null }), false)
  assert.equal(showPartnerPanel({ requiresMarker: false, isSharedDeviceScoring: true, liveMarkedPresent: true, partnerName: 'Paper' }), true)
  assert.equal(showPartnerPanel({ requiresMarker: false, isSharedDeviceScoring: false, liveMarkedPresent: true, partnerName: 'X' }), false)
})
test('the not-started note is hidden as soon as the partner is detected', () => {
  assert.equal(partnerNotStartedNote({ isSharedDeviceScoring: false, partnerName: 'TEST', partnerSelfEntryCount: 0 }), null) // V7: hidden once the partner is detected
  assert.equal(partnerNotStartedNote({ isSharedDeviceScoring: false, partnerName: 'TEST', partnerSelfEntryCount: 1 }), null)
  assert.equal(partnerNotStartedNote({ isSharedDeviceScoring: true, partnerName: 'Paper', partnerSelfEntryCount: 0 }), null)
  assert.equal(partnerNotStartedNote({ isSharedDeviceScoring: false, partnerName: null, partnerSelfEntryCount: 0 }), null)
})
test('the shell never gates the partner UI on the frozen server prop again', () => {
  assert.doesNotMatch(shell, /&& markedScorecard && partnerName/)
  assert.doesNotMatch(shell, /!markedScorecard && partnerName/)
  assert.match(shell, /showPartnerPanel\(\{ requiresMarker, isSharedDeviceScoring, liveMarkedPresent: !!currentMarked, partnerName \}\)/)
  // the submit-time rejected-entry check must cover a partner who joined after first render
  assert.match(shell, /\[currentMy\?\.id, currentMarked\?\.id\]/)
})
test('live refresh is a genuine fresh read and still never touches the current hole or drafts', () => {
  assert.match(shell, /fetch\(`\/api\/trips\/\$\{tripId\}\/rounds\/\$\{roundId\}\/my-scores`, \{ cache: 'no-store' \}\)/)
  assert.match(shell, /refetchOnWindowFocus: true/)
  assert.match(shell, /refetchOnReconnect: true/)
  const hydrate = shell.slice(shell.indexOf('async function hydrate()'), shell.indexOf('if (!resumed) {'))
  assert.doesNotMatch(hydrate, /setHoleIdx|setDraft/)
  assert.match(hydrate, /getQueuedEntriesForScorecards/) // queued (unsynced) strokes are overlaid on every refresh
})
