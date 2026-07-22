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
