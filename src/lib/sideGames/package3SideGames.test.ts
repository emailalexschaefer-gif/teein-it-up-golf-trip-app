// Package 3 -- Side Game arrival prompts, nomination permissions, verification panel, capture, hole pars.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { arrivalReminders, arrivalSeenKey, sideGameAnchorId } from './arrivalPrompt'
import { holeOptionLabel } from './holeOptionLabel'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

// ── arrival reminders ─────────────────────────────────────────────────────────
test('15-17 each game gets its own concise reminder wording, from the real config', () => {
  const r = arrivalReminders([{ id: 'a', comp_type: 'nearest_pin' }, { id: 'b', comp_type: 'longest_drive' }, { id: 'c', comp_type: 'pros_approach' }], 7)
  assert.equal(r[0].headline, 'Nearest the Pin — Hole 7')
  assert.equal(r[0].text, 'Nearest the Pin is active on this hole. Remember to nominate your qualifying shot.')
  assert.equal(r[1].text, 'Longest Drive is active on this hole. Check the rules and nominate a qualifying drive.')
  assert.equal(r[2].text, 'Pro’s Approach is active on this hole. Check the competition requirements.')
})
test('18-19 two games on one hole, and two instances of the same game, are separate reminders', () => {
  const two = arrivalReminders([{ id: 'a', comp_type: 'nearest_pin' }, { id: 'b', comp_type: 'longest_drive' }], 4)
  assert.equal(two.length, 2)
  const same = arrivalReminders([{ id: 'x', comp_type: 'nearest_pin' }, { id: 'y', comp_type: 'nearest_pin' }], 4)
  assert.deepEqual(same.map(s => s.id), ['x', 'y'])
  assert.notEqual(arrivalSeenKey('r', 'x'), arrivalSeenKey('r', 'y'))
  assert.notEqual(sideGameAnchorId('x'), sideGameAnchorId('y'))
})
test('Powerplay and unknown types never produce a reminder; no comps -> none', () => {
  assert.deepEqual(arrivalReminders([{ id: 'p', comp_type: 'powerplay' }, { id: 'q', comp_type: 'mystery' }], 3), [])
  assert.deepEqual(arrivalReminders([], 3), [])
})
test('pins: reminder is inline (not a modal), remembered per session, and mounted in both scoring shells on the real per-hole list', () => {
  const c = read('src/components/scoring/SideGameArrivalPrompt.tsx')
  assert.doesNotMatch(c, /position: 'fixed'|aria-modal/)
  assert.match(c, /sessionStorage/)
  for (const shell of ['SelfMarkerScoreShell', 'ScoreSessionShell']) {
    const s = read(`src/app/(app)/trips/[tripId]/rounds/[roundId]/${shell}.tsx`)
    assert.match(s, /<SideGameArrivalPrompt roundId=\{round\.id\} holeNumber=\{holeNum\} comps=\{activeSideComps\} \/>/)
    assert.match(s, /id=\{sideGameAnchorId\(comp\.id\)\}/)
    assert.match(s, /activeSideComps = sideComps\.filter\(c => c\.enabled && c\.hole_number === holeNum/)
  }
})

// ── nomination permissions (server side) ──────────────────────────────────────
test('20-23 pins: nomination is self, or someone in the caller\'s own playing group who is in this round -- enforced in the route', () => {
  const r = read('src/app/api/trips/[tripId]/side-comps/[sideCompId]/entries/route.ts')
  assert.match(r, /const requestedPlayerId = typeof body\.playerId === 'string' \? body\.playerId : user\.id/)
  assert.match(r, /submitterGroupId !== nomineeGroupId/)
  assert.match(r, /You can only enter a result for someone in your own playing group\./)
  assert.match(r, /That player is not in this round\./)
  assert.match(r, /compRes\.data\.trip_id !== tripId/) // cross-event rejected
  assert.match(r, /p_entered_by: user\.id/)            // audit: who actually entered it
})

// ── verification ──────────────────────────────────────────────────────────────
test('24-25 verification panel: prominent, Confirm / Modify / Reject, one decision at a time', () => {
  const c = read('src/components/scoring/PendingVerificationCard.tsx')
  assert.match(c, /Side Game Verification Required/)
  assert.match(c, /useState\(true\)/)             // open by default, never a modal
  assert.doesNotMatch(c, /position: 'fixed'/)
  assert.match(c, /Modify/); assert.match(c, /Reject/); assert.match(c, /Confirm/)
  assert.match(c, /disabled=\{submitting !== null\}/) // repeated taps cannot double-submit
  assert.match(c, /startVisibilityPolling\(load, 15000\)/) // 26 survives refresh/reconnect: server-driven list
})
test('verify route: authority is checked server-side inside the RPC; rejected results never become official', () => {
  const r = read('src/app/api/trips/[tripId]/side-comps/[sideCompId]/entries/[entryId]/verify/route.ts')
  assert.match(r, /decision !== 'confirm' && decision !== 'correct' && decision !== 'reject'/)
  assert.match(r, /Only the assigned verifier/)
  assert.match(r, /p_verifier_id: verifierId/)
})
test('group-scorer rounds also show the verification panel', () => {
  assert.match(read('src/app/(app)/trips/[tripId]/rounds/[roundId]/ScoreSessionShell.tsx'), /<PendingVerificationCard tripId=\{tripId\} roundId=\{round\.id\} \/>/)
})

// ── capture the moment ────────────────────────────────────────────────────────
test('27-30 capture is offered after any qualifying nomination, optional, skippable, reuses Moments (photo, video, gallery)', () => {
  const panel = read('src/components/scoring/SideCompEntryPanel.tsx')
  assert.match(panel, /if \(result\.wouldLeadIfVerified \|\| qualified\) onWouldLeadIfVerified\?\.\(result\)/)
  const prompt = read('src/components/scoring/NewLeaderPrompt.tsx')
  assert.match(prompt, /Capture the Moment!/); assert.match(prompt, /Skip/)
  assert.match(prompt, /<MomentCapture/); assert.match(prompt, /sideCompContext=/)
  assert.match(prompt, /your nomination is already saved/)
  const mc = read('src/components/moments/MomentCapture.tsx')
  assert.match(mc, /VIDEO_ACCEPTED_TYPES/); assert.match(mc, /uploading/)
  // nomination is saved by its own request BEFORE the prompt exists, so an upload failure cannot lose it
  assert.ok(panel.indexOf('setMyEntryId(result.entryId)') < panel.indexOf('onWouldLeadIfVerified?.(result)'))
})

// ── hole pars in setup ────────────────────────────────────────────────────────
test('31-32 hole labels: par from the round\'s own frozen course data; back nine / shotgun-order holes; never invented', () => {
  const snap = Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, par: [4, 5, 3][i % 3] }))
  assert.equal(holeOptionLabel(3, snap), 'Hole 3 — Par 3')
  assert.equal(holeOptionLabel(10, snap), 'Hole 10 — Par 4')
  assert.equal(holeOptionLabel(18, snap), 'Hole 18 — Par 3')
  assert.equal(holeOptionLabel(5, null), 'Hole 5')
  assert.equal(holeOptionLabel(5, snap.slice(0, 4)), 'Hole 5')
  assert.match(read('src/components/trips/wizard/StepRounds.tsx'), /computeHolePlayOrder\(round\.holes, round\.starting_hole_number \?\? 1\)/)
})
