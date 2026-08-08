import test from 'node:test'
import assert from 'node:assert/strict'
import { compareCaptures } from './comparison'

test('neither entered -> not_started', () => {
  assert.equal(compareCaptures(null, null), 'not_started')
})

test('self entered, marker not -> pending_marker', () => {
  assert.equal(compareCaptures({ grossScore: 5, pickedUp: false }, null), 'pending_marker')
})

test('marker entered, self not -> pending_self', () => {
  assert.equal(compareCaptures(null, { grossScore: 5, pickedUp: false }), 'pending_self')
})

test('both entered, same score -> matched', () => {
  assert.equal(compareCaptures({ grossScore: 5, pickedUp: false }, { grossScore: 5, pickedUp: false }), 'matched')
})

test('both entered, different score -> mismatch (the brief\'s worked example)', () => {
  // Alex self-recorded Hole 7: 5. Darren recorded Alex Hole 7: 6.
  assert.equal(compareCaptures({ grossScore: 5, pickedUp: false }, { grossScore: 6, pickedUp: false }), 'mismatch')
})

test('both picked up -> matched, regardless of any stale gross score', () => {
  assert.equal(compareCaptures({ grossScore: null, pickedUp: true }, { grossScore: null, pickedUp: true }), 'matched')
})

test('self picked up, marker entered a numeric score -> mismatch', () => {
  assert.equal(compareCaptures({ grossScore: null, pickedUp: true }, { grossScore: 6, pickedUp: false }), 'mismatch')
})

test('self entered a numeric score, marker picked up -> mismatch', () => {
  assert.equal(compareCaptures({ grossScore: 5, pickedUp: false }, { grossScore: null, pickedUp: true }), 'mismatch')
})

test('a capture object with pickedUp false and grossScore null counts as not entered', () => {
  assert.equal(compareCaptures({ grossScore: null, pickedUp: false }, { grossScore: 5, pickedUp: false }), 'pending_self')
})

// ── isZeroPointsMismatch — Stage 3 field-test bug ───────────────────────────
// The exact real-world case: one scorer entered a numeric gross score
// that happened to produce 0 Stableford points, the other selected Pick
// Up (also 0 points). compareCaptures must keep reporting 'mismatch'
// (the raw entries genuinely differ, and the brief is explicit that
// this must not be silently merged) — isZeroPointsMismatch is what lets
// the UI additionally recognise this specific case for softer wording.
import { isZeroPointsMismatch } from './comparison'

test('isZeroPointsMismatch — the exact reported case: high gross score (0 pts) vs pick-up (0 pts)', () => {
  // Par 4, SI 10, handicap 0 (no strokes) — a gross score of 9 is well
  // outside Stableford's scoring range and correctly resolves to 0 pts.
  const self   = { grossScore: 9, pickedUp: false }
  const marker = { grossScore: null, pickedUp: true }
  const context = { par: 4, strokeIndex: 10, selfHandicap: 0, markerHandicap: 0 }

  // The underlying status is still, correctly, 'mismatch' — unchanged.
  assert.equal(compareCaptures(self, marker), 'mismatch')
  // But this specific case is recognised as "both worth zero anyway".
  assert.equal(isZeroPointsMismatch(self, marker, context), true)
})

test('isZeroPointsMismatch — false when the scores genuinely disagree and are not both zero', () => {
  const self   = { grossScore: 5, pickedUp: false }
  const marker = { grossScore: 6, pickedUp: false }
  const context = { par: 4, strokeIndex: 10, selfHandicap: 5, markerHandicap: 5 }
  assert.equal(isZeroPointsMismatch(self, marker, context), false)
})

test('isZeroPointsMismatch — false when the status is not a mismatch at all', () => {
  const self   = { grossScore: 5, pickedUp: false }
  const marker = { grossScore: 5, pickedUp: false }
  const context = { par: 4, strokeIndex: 10, selfHandicap: 5, markerHandicap: 5 }
  assert.equal(isZeroPointsMismatch(self, marker, context), false)
})

test('isZeroPointsMismatch — false when only one side is worth zero points', () => {
  // Self picked up (0 pts); marker entered a score that actually scores.
  const self   = { grossScore: null, pickedUp: true }
  const marker = { grossScore: 4, pickedUp: false } // birdie-ish, scores points
  const context = { par: 4, strokeIndex: 10, selfHandicap: 0, markerHandicap: 0 }
  assert.equal(isZeroPointsMismatch(self, marker, context), false)
})

test('isZeroPointsMismatch — both picked up is already \'matched\', not a mismatch to soften', () => {
  const self   = { grossScore: null, pickedUp: true }
  const marker = { grossScore: null, pickedUp: true }
  const context = { par: 4, strokeIndex: 10, selfHandicap: 0, markerHandicap: 0 }
  assert.equal(compareCaptures(self, marker), 'matched')
  assert.equal(isZeroPointsMismatch(self, marker, context), false)
})
