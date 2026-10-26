// Package 2 -- proves the CANONICAL scoring engine already supports plus handicaps (no engine change was made).
// Representation: plus-4 = -4, plus-2 = -2, scratch = 0. A plus golfer GIVES strokes back on the easiest holes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getHandicapStrokesForHole } from './strokeAllocation'
import { calculateStableford } from './stableford'
import { calculateDailyHandicap } from './dailyHandicap'
import { formatGolfHandicap, formatGolfHandicapWithStored } from './handicapDisplay'

const strokesBySI = (h: number) => Array.from({ length: 18 }, (_, i) => getHandicapStrokesForHole({ playingHandicap: h, strokeIndex: i + 1 }))

test('plus-2 (stored -2): gives back one stroke on SI 17 and 18 only; never ADDS strokes', () => {
  const s = strokesBySI(-2)
  assert.deepEqual(s.slice(0, 16), Array(16).fill(0))
  assert.deepEqual(s.slice(16), [-1, -1])
  assert.equal(s.reduce((a, b) => a + b, 0), -2)
})
test('plus-4 (stored -4): gives back one stroke on SI 15-18', () => {
  const s = strokesBySI(-4)
  assert.deepEqual(s.slice(0, 14), Array(14).fill(0))
  assert.deepEqual(s.slice(14), [-1, -1, -1, -1])
})
test('scratch, 18 and 36 are unchanged', () => {
  assert.deepEqual(strokesBySI(0), Array(18).fill(0))
  assert.deepEqual(strokesBySI(18), Array(18).fill(1))
  assert.deepEqual(strokesBySI(36), Array(18).fill(2))
})
test('strokes always sum to the playing handicap (including values past 54 and well below -10)', () => {
  for (const h of [-15, -10, -4, -2, 0, 1, 18, 36, 54, 55, 74]) assert.equal(strokesBySI(h).reduce((a, b) => a + b, 0), h, String(h))
})
test('Stableford: plus-2 golfer making par on SI 18 scores 1 point (nett bogey), on SI 1 scores 2; a +2 is NOT treated as +2 strokes received', () => {
  const pts = (si: number, h: number) => calculateStableford({ grossScore: 4, par: 4, strokeIndex: si, playingHandicap: h })
  assert.equal(pts(18, -2), 1)
  assert.equal(pts(17, -2), 1)
  assert.equal(pts(16, -2), 2)
  assert.equal(pts(1, -2), 2)
  assert.equal(pts(18, 2), 2) // a genuine +2 strokes received (handicap 2) gives a stroke only on SI 1-2
  assert.equal(pts(1, 2), 3)  // proves the two are NOT interchangeable
  assert.equal(pts(1, -4), 2)
  assert.equal(pts(15, -4), 1)
})
test('Stableford 18-hole totals for a pars-only round: plus-4 = 32, plus-2 = 34, scratch = 36, 18 = 54, 36 = 72', () => {
  const total = (h: number) => Array.from({ length: 18 }, (_, i) => calculateStableford({ grossScore: 4, par: 4, strokeIndex: i + 1, playingHandicap: h })).reduce((a, b) => a + b, 0)
  assert.equal(total(-4), 32); assert.equal(total(-2), 34); assert.equal(total(0), 36); assert.equal(total(18), 54); assert.equal(total(36), 72)
})
test('Daily Handicap keeps the sign: plus-2 Handicap Index stays a plus handicap after slope; never flips positive', () => {
  assert.equal(calculateDailyHandicap({ gaHandicap: -2, slopeRating: 130 }), -2)
  assert.equal(calculateDailyHandicap({ gaHandicap: -4, slopeRating: 140 }), -5) // -4.96 -> -5
  assert.ok(calculateDailyHandicap({ gaHandicap: -0.4, slopeRating: 113 }) <= 0)
})
test('golf notation display: stored -2 shows +2; stored value is never altered', () => {
  assert.equal(formatGolfHandicap(-4), '+4'); assert.equal(formatGolfHandicap(-2), '+2'); assert.equal(formatGolfHandicap(0), '0')
  assert.equal(formatGolfHandicap(18), '18'); assert.equal(formatGolfHandicap(36), '36'); assert.equal(formatGolfHandicap(-1.5), '+1.5')
  assert.equal(formatGolfHandicap(12.4), '12.4'); assert.equal(formatGolfHandicap(null), '—')
  assert.equal(formatGolfHandicapWithStored(-2), '+2 (stored -2)')
})
