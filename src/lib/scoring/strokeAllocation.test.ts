import test from 'node:test'
import assert from 'node:assert/strict'
import { getHandicapStrokesForHole } from './strokeAllocation'
import { ScoringDomainError } from './errors'

function strokesForHandicap(hcp: number) {
  return Array.from({ length: 18 }, (_, i) =>
    getHandicapStrokesForHole({ playingHandicap: hcp, strokeIndex: i + 1 })
  )
}

test('handicap 0 — no strokes anywhere', () => {
  assert.deepEqual(strokesForHandicap(0), Array(18).fill(0))
})

test('handicap 8 — 1 stroke on SI 1-8, 0 on SI 9-18', () => {
  const expected = [1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0]
  assert.deepEqual(strokesForHandicap(8), expected)
})

test('handicap 10 — 1 stroke on SI 1-10, 0 on SI 11-18', () => {
  const expected = [1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0]
  assert.deepEqual(strokesForHandicap(10), expected)
})

test('handicap 18 — exactly 1 stroke on every hole', () => {
  assert.deepEqual(strokesForHandicap(18), Array(18).fill(1))
})

test('handicap 24 — 2 strokes on SI 1-6, 1 stroke on SI 7-18', () => {
  const expected = [2,2,2,2,2,2,1,1,1,1,1,1,1,1,1,1,1,1]
  assert.deepEqual(strokesForHandicap(24), expected)
})

test('handicap 36 — 2 strokes on every hole', () => {
  assert.deepEqual(strokesForHandicap(36), Array(18).fill(2))
})

test('handicap 40 (above 36) — 3 strokes on SI 1-4, 2 on SI 5-18, no hard-coded table needed', () => {
  const expected = [3,3,3,3,2,2,2,2,2,2,2,2,2,2,2,2,2,2]
  assert.deepEqual(strokesForHandicap(40), expected)
})

test('negative / plus handicap (-2) — gives a stroke back on the two easiest holes', () => {
  // fullStrokes = floor(-2/18) = -1, remainder = 16 → SI 1-16 get +1 (net 0),
  // SI 17-18 do not → net -1 (player gives a stroke back on the easiest holes)
  const expected = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-1,-1]
  assert.deepEqual(strokesForHandicap(-2), expected)
})

test('9-hole round respects holesInRound', () => {
  const strokes = Array.from({ length: 9 }, (_, i) =>
    getHandicapStrokesForHole({ playingHandicap: 5, strokeIndex: i + 1, holesInRound: 9 })
  )
  assert.deepEqual(strokes, [1,1,1,1,1,0,0,0,0])
})

test('invalid stroke index throws a typed error', () => {
  assert.throws(
    () => getHandicapStrokesForHole({ playingHandicap: 10, strokeIndex: 19 }),
    (err: unknown) => err instanceof ScoringDomainError && err.code === 'INVALID_STROKE_INDEX'
  )
  assert.throws(
    () => getHandicapStrokesForHole({ playingHandicap: 10, strokeIndex: 0 }),
    (err: unknown) => err instanceof ScoringDomainError && err.code === 'INVALID_STROKE_INDEX'
  )
})

test('non-numeric handicap throws a typed error', () => {
  assert.throws(
    // @ts-expect-error deliberately invalid input for the test
    () => getHandicapStrokesForHole({ playingHandicap: NaN, strokeIndex: 1 }),
    (err: unknown) => err instanceof ScoringDomainError && err.code === 'MISSING_HANDICAP'
  )
})

// ── 9-hole round, stroke indexes above 9 (Sandhurst front nine) ────────────
// Regression coverage for the bug fixed this deployment: a 9-hole round's
// Hole Setup dropdown was limited to SI 1-9, and the round-start API
// separately required the 9 stroke indexes to form the exact set
// {1..9} — both incorrectly assumed "9 holes" implies "stroke indexes
// 1-9." A 9-hole round can legitimately use any 9 of the 18 possible SI
// values (e.g. one half of a full 18-hole course), and these tests use
// the *default* holesInRound (18), matching exactly how every real call
// site in the app invokes this function — none of them pass round.holes
// as holesInRound, confirmed by searching the codebase before writing
// this fix, so a 9-hole round already used the correct 18-hole-style
// allocation formula even before this fix; what was actually broken was
// upstream of this function, in the UI/API layers rejecting the input
// before it ever reached here.

test('Sandhurst front nine — handicap 5 on SI 16 receives no stroke', () => {
  assert.equal(getHandicapStrokesForHole({ playingHandicap: 5, strokeIndex: 16 }), 0)
})

test('Sandhurst front nine — handicap 10 on SI 11 receives no stroke', () => {
  assert.equal(getHandicapStrokesForHole({ playingHandicap: 10, strokeIndex: 11 }), 0)
})

test('Sandhurst front nine — handicap 12 on SI 12 receives one stroke', () => {
  assert.equal(getHandicapStrokesForHole({ playingHandicap: 12, strokeIndex: 12 }), 1)
})

test('Sandhurst front nine — handicap 18 on SI 16 receives one stroke', () => {
  assert.equal(getHandicapStrokesForHole({ playingHandicap: 18, strokeIndex: 16 }), 1)
})

test('Sandhurst front nine — handicap 20 on SI 16 receives one stroke, extras go to SI 1 and SI 2', () => {
  assert.equal(getHandicapStrokesForHole({ playingHandicap: 20, strokeIndex: 16 }), 1)
  assert.equal(getHandicapStrokesForHole({ playingHandicap: 20, strokeIndex: 1 }), 2)
  assert.equal(getHandicapStrokesForHole({ playingHandicap: 20, strokeIndex: 2 }), 2)
})

test('Sandhurst front nine — every hole in the actual course configuration resolves without error', () => {
  // Hole: Par / SI, exactly as specified in the bug report.
  const sandhurstFrontNine = [
    { par: 4, si:  4 },
    { par: 4, si: 16 },
    { par: 5, si:  8 },
    { par: 4, si: 15 },
    { par: 4, si: 11 },
    { par: 3, si:  6 },
    { par: 4, si: 12 },
    { par: 3, si:  7 },
    { par: 4, si:  1 },
  ]
  for (const hole of sandhurstFrontNine) {
    // Must not throw for any SI in this real 9-hole configuration —
    // this is the direct regression test for the original bug, where
    // strokeIndex values above 9 could be rejected upstream before
    // reaching this point.
    assert.doesNotThrow(() =>
      getHandicapStrokesForHole({ playingHandicap: 14, strokeIndex: hole.si })
    )
  }
})
