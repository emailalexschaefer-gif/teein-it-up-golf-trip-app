import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMismatchWarning, shouldWarn, describeEntry, type MismatchInput } from './mismatchWarning'
import { compareCaptures, type CaptureValue } from './comparison'

const cap = (g: number | null, pickedUp = false): CaptureValue => ({ grossScore: g, pickedUp })
const input = (o: Partial<MismatchInput> = {}): MismatchInput => ({
  holeNumber: 7, myName: 'Alex', partnerName: 'Sam',
  myStatus: compareCaptures(cap(4), cap(5)), partnerStatus: null,
  myDraft: cap(4), myMarkerEntry: cap(5), partnerDraft: null, partnerSelfEntry: null, ...o,
})

test('1 matching 4/4 -> no warning', () => {
  assert.equal(buildMismatchWarning(input({ myStatus: compareCaptures(cap(4), cap(4)), myMarkerEntry: cap(4) })), null)
})
test('2 mismatching 4/5 -> warning for Hole 7 with both entries', () => {
  const w = buildMismatchWarning(input())!
  assert.equal(w.holeNumber, 7)
  assert.equal(w.items.length, 1)
  assert.deepEqual([w.items[0].yourEntry, w.items[0].otherEntry, w.items[0].golfer], ['4 strokes', '5 strokes', 'Alex'])
  assert.match(w.items[0].yourLabel, /Your entry for Alex/)
})
test('5 several disagreements on one hole -> ONE warning listing each golfer', () => {
  const w = buildMismatchWarning(input({ partnerStatus: 'mismatch', partnerDraft: cap(6), partnerSelfEntry: cap(5) }))!
  assert.deepEqual(w.items.map(x => x.golfer), ['Alex', 'Sam'])
})
test('6 marker has not submitted -> waiting, never a mismatch', () => {
  assert.equal(compareCaptures(cap(4), null), 'pending_marker')
  assert.equal(buildMismatchWarning(input({ myStatus: compareCaptures(cap(4), null), myMarkerEntry: null })), null)
})
test('7/8 shared-device and paper pairs (no comparison status) never warn', () => {
  assert.equal(buildMismatchWarning(input({ myStatus: null, partnerStatus: null })), null)
})
test('9 offline / entry not yet synced is a waiting state, not a mismatch', () => {
  assert.equal(buildMismatchWarning(input({ myStatus: compareCaptures(cap(4), cap(null)) })), null)
})
test('organiser-resolved hole does not warn', () => {
  assert.equal(buildMismatchWarning(input({ myStatus: compareCaptures({ ...cap(4), adminOverridden: true }, cap(5)) })), null)
})
test('12 no endless loop: once continued, the same disagreement is not shown again; a CHANGED disagreement is', () => {
  const w = buildMismatchWarning(input())!
  const ack = new Set<string>()
  assert.equal(shouldWarn('forward', w, ack), true)
  ack.add(w.signature)
  assert.equal(shouldWarn('forward', w, ack), false)
  const changed = buildMismatchWarning(input({ myDraft: cap(3), myStatus: compareCaptures(cap(3), cap(5)) }))!
  assert.equal(shouldWarn('forward', changed, ack), true)
})
test('backward navigation never warns', () => {
  assert.equal(shouldWarn('backward', buildMismatchWarning(input()), new Set()), false)
})
test('entries describe honestly: picked up, none, singular stroke; nothing invented', () => {
  assert.equal(describeEntry(cap(null, true)), 'Picked up'); assert.equal(describeEntry(null), 'No score yet')
  assert.equal(describeEntry(cap(1)), '1 stroke'); assert.equal(describeEntry(cap(0)), '0 strokes')
})
test('warning logic does not touch reconciliation: pure read of statuses (source has no writes)', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'mismatchWarning.ts'), 'utf8')
  assert.doesNotMatch(src, /fetch\(|supabase|from\('|\.rpc\(|\.update\(|\.insert\(/)
})

// ── wiring pins (the shell cannot be rendered in the sandbox) ─────────────────
const SHELL = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app/(app)/trips/[tripId]/rounds/[roundId]/SelfMarkerScoreShell.tsx'), 'utf8')
test('pins: warning sits in the single shared forward-navigation path, after the save, and never discards it', () => {
  const fn = SHELL.slice(SHELL.indexOf('async function saveAndAdvance'), SHELL.indexOf('function navigateHole'))
  assert.ok(fn.indexOf('saveCurrentHoleData()') < fn.indexOf('buildMismatchWarning'), 'warn only after the save')
  assert.match(fn, /if \(!outcome\.ok\)[\s\S]*return[\s\S]*buildMismatchWarning/) // a failed save keeps the existing failure UI
  assert.match(fn, /shouldWarn\(direction, warning, acknowledgedMismatchesRef\.current\)/)
})
test('pins: Continue Scoring only records the acknowledgement and navigates; it writes nothing and clears nothing', () => {
  const i = SHELL.indexOf('data-testid="mismatch-continue"')
  const block = SHELL.slice(i, i + 400)
  assert.match(block, /acknowledgedMismatchesRef\.current\.add/)
  assert.match(block, /navigateHole\('forward'\)/)
  assert.doesNotMatch(block, /fetch\(|setMy|setPartner|queue|admin/i)
})
test('pins: Review Scores stays on the same hole and scrolls to its reconciliation panel', () => {
  const i = SHELL.indexOf('data-testid="mismatch-review"')
  const block = SHELL.slice(i, i + 500)
  assert.doesNotMatch(block, /setHoleIdx|navigateHole/)
  assert.match(block, /mismatch-reconciliation/)
  assert.match(SHELL, /<div id="mismatch-reconciliation" \/>/)
})
test('pins: swipe and both buttons share saveAndAdvance, so every forward route (incl. final hole -> summary, shotgun) is covered', () => {
  assert.equal((SHELL.match(/saveAndAdvance\('forward'\)/g) ?? []).length >= 2, true)
  assert.match(SHELL, /dx < 0\) void saveAndAdvance\('forward'\)/)
})
