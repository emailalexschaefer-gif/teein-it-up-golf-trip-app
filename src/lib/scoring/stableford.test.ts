import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateStableford } from './stableford'
import { ScoringDomainError } from './errors'

// A hole a scratch (0 handicap) player receives no strokes on: par 4, SI 1, hcp 0
test('gross par with no stroke = 2', () => {
  assert.equal(calculateStableford({ grossScore: 4, par: 4, strokeIndex: 1, playingHandicap: 0 }), 2)
})

test('gross bogey with no stroke = 1', () => {
  assert.equal(calculateStableford({ grossScore: 5, par: 4, strokeIndex: 1, playingHandicap: 0 }), 1)
})

test('gross bogey with one stroke = 2 (nett par)', () => {
  // hcp 10, SI <= 10 → 1 stroke received
  assert.equal(calculateStableford({ grossScore: 5, par: 4, strokeIndex: 1, playingHandicap: 10 }), 2)
})

test('gross double bogey with one stroke = 1 (nett bogey)', () => {
  assert.equal(calculateStableford({ grossScore: 6, par: 4, strokeIndex: 1, playingHandicap: 10 }), 1)
})

test('gross double bogey with two strokes = 2 (nett par)', () => {
  // hcp 24, SI 1 → 2 strokes received
  assert.equal(calculateStableford({ grossScore: 6, par: 4, strokeIndex: 1, playingHandicap: 24 }), 2)
})

test('nett double bogey or worse = 0', () => {
  assert.equal(calculateStableford({ grossScore: 8, par: 4, strokeIndex: 18, playingHandicap: 0 }), 0)
})

test('nett birdie = 3', () => {
  assert.equal(calculateStableford({ grossScore: 3, par: 4, strokeIndex: 1, playingHandicap: 0 }), 3)
})

test('nett eagle = 4', () => {
  assert.equal(calculateStableford({ grossScore: 2, par: 4, strokeIndex: 1, playingHandicap: 0 }), 4)
})

test('nett albatross = 5', () => {
  assert.equal(calculateStableford({ grossScore: 1, par: 4, strokeIndex: 1, playingHandicap: 0 }), 5)
})

test('result better than albatross is not capped — no hard-coded table ceiling', () => {
  // par 5, gross 1 (a hole-in-one), 2 strokes received (hcp 19 → SI 1 gets
  // floor(19/18)=1 full stroke + 1 extra, since SI 1 <= remainder 1) →
  // nett = 1 - 2 = -1 → 2 + 5 - (-1) = 8, well past "albatross" (5)
  const pts = calculateStableford({ grossScore: 1, par: 5, strokeIndex: 1, playingHandicap: 19 })
  assert.equal(pts, 8)
  assert.ok(pts > 5, 'previously this was silently capped at 5 by Math.min(5, ...)')
})

test('worked example from the brief: par 4, gross 5, 1 stroke received → nett par → 2 points', () => {
  assert.equal(calculateStableford({ grossScore: 5, par: 4, strokeIndex: 1, playingHandicap: 10 }), 2)
})

test('handicap 24 stroke allocation feeds correctly into Stableford across all 18 holes', () => {
  // Same gross score (par + 2, a double bogey) on every hole. SI 1-6 get 2 strokes (nett par → 2pts),
  // SI 7-18 get 1 stroke (nett bogey → 1pt).
  const results = Array.from({ length: 18 }, (_, i) => {
    const si = i + 1
    return calculateStableford({ grossScore: 6, par: 4, strokeIndex: si, playingHandicap: 24 })
  })
  assert.deepEqual(results, [2,2,2,2,2,2,1,1,1,1,1,1,1,1,1,1,1,1])
})

test('handicap 36 stroke allocation — 2 strokes everywhere', () => {
  const results = Array.from({ length: 18 }, (_, i) =>
    calculateStableford({ grossScore: 6, par: 4, strokeIndex: i + 1, playingHandicap: 36 })
  )
  assert.deepEqual(results, Array(18).fill(2))
})

test('invalid gross score throws a typed error, never silently returns 0', () => {
  assert.throws(
    () => calculateStableford({ grossScore: 0, par: 4, strokeIndex: 1, playingHandicap: 0 }),
    (err: unknown) => err instanceof ScoringDomainError && err.code === 'NON_NUMERIC_VALUE'
  )
})
