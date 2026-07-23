import test from 'node:test'
import assert from 'node:assert/strict'
import { isCaptureAllowed } from './captureMode'

// ── self_and_marker ────────────────────────────────────────────────────────
test('self_and_marker: own card, self role -> allowed', () => {
  assert.equal(isCaptureAllowed({ mode: 'self_and_marker', captureRole: 'self', isOwnCard: true, isOrganiser: false }), true)
})
test('self_and_marker: not own card, self role -> denied', () => {
  assert.equal(isCaptureAllowed({ mode: 'self_and_marker', captureRole: 'self', isOwnCard: false, isOrganiser: false }), false)
})
test('self_and_marker: assigned marker, marker role -> allowed', () => {
  assert.equal(isCaptureAllowed({ mode: 'self_and_marker', captureRole: 'marker', isOwnCard: false, isOrganiser: false, isAssignedMarker: true }), true)
})
test('self_and_marker: not the assigned marker, marker role -> denied', () => {
  assert.equal(isCaptureAllowed({ mode: 'self_and_marker', captureRole: 'marker', isOwnCard: false, isOrganiser: false, isAssignedMarker: false }), false)
})
test('self_and_marker: same playing group but NOT assigned marker -> still denied (group membership alone is not enough in this mode)', () => {
  assert.equal(isCaptureAllowed({ mode: 'self_and_marker', captureRole: 'marker', isOwnCard: false, isOrganiser: false, isSamePlayingGroup: true, isAssignedMarker: false }), false)
})

// ── individual — the mode under review ─────────────────────────────────────
test('individual: own card, self role -> allowed', () => {
  assert.equal(isCaptureAllowed({ mode: 'individual', captureRole: 'self', isOwnCard: true, isOrganiser: false }), true)
})
test('individual: not own card, self role -> denied', () => {
  assert.equal(isCaptureAllowed({ mode: 'individual', captureRole: 'self', isOwnCard: false, isOrganiser: false }), false)
})
test('individual: marker role is NEVER allowed, even if isAssignedMarker is somehow true', () => {
  assert.equal(isCaptureAllowed({ mode: 'individual', captureRole: 'marker', isOwnCard: false, isOrganiser: false, isAssignedMarker: true }), false)
})
test('individual: marker role denied even for same playing group', () => {
  assert.equal(isCaptureAllowed({ mode: 'individual', captureRole: 'marker', isOwnCard: false, isOrganiser: false, isSamePlayingGroup: true }), false)
})
test('individual: organiser may still write any role', () => {
  assert.equal(isCaptureAllowed({ mode: 'individual', captureRole: 'self', isOwnCard: false, isOrganiser: true }), true)
  assert.equal(isCaptureAllowed({ mode: 'individual', captureRole: 'marker', isOwnCard: false, isOrganiser: true }), true)
})

// ── group_scorer — legacy mode, unchanged behaviour ────────────────────────
test('group_scorer: same playing group, self role -> allowed', () => {
  assert.equal(isCaptureAllowed({ mode: 'group_scorer', captureRole: 'self', isOwnCard: false, isOrganiser: false, isSamePlayingGroup: true }), true)
})
test('group_scorer: different group, self role -> denied', () => {
  assert.equal(isCaptureAllowed({ mode: 'group_scorer', captureRole: 'self', isOwnCard: false, isOrganiser: false, isSamePlayingGroup: false }), false)
})
test('group_scorer: marker role never applies, always denied regardless of flags', () => {
  assert.equal(isCaptureAllowed({ mode: 'group_scorer', captureRole: 'marker', isOwnCard: true, isOrganiser: false, isSamePlayingGroup: true, isAssignedMarker: true }), false)
})
test('group_scorer: own card always allowed regardless of group flag', () => {
  assert.equal(isCaptureAllowed({ mode: 'group_scorer', captureRole: 'self', isOwnCard: true, isOrganiser: false, isSamePlayingGroup: false }), true)
})

// ── organiser bypass applies identically across all three modes ───────────
test('organiser bypass applies in every mode', () => {
  for (const mode of ['self_and_marker', 'individual', 'group_scorer'] as const) {
    for (const captureRole of ['self', 'marker'] as const) {
      assert.equal(isCaptureAllowed({ mode, captureRole, isOwnCard: false, isOrganiser: true }), true, `${mode}/${captureRole}`)
    }
  }
})
