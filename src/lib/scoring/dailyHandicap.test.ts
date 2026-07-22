import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateDailyHandicap } from './dailyHandicap'
import { ScoringDomainError } from './errors'

test('worked example from the brief: 8.8 at slope 138 → 11', () => {
  // 8.8 × 138 ÷ 113 = 10.747... → rounds to 11
  assert.equal(calculateDailyHandicap({ gaHandicap: 8.8, slopeRating: 138 }), 11)
})

test('slope 113 (standard/neutral slope) passes the GA handicap through unchanged', () => {
  assert.equal(calculateDailyHandicap({ gaHandicap: 10, slopeRating: 113 }), 10)
  assert.equal(calculateDailyHandicap({ gaHandicap: 15.4, slopeRating: 113 }), 15) // 15.4 rounds down
})

test('decimal boundary: produces exactly .50 and rounds up', () => {
  // 10 × 113.0 / 113 = 10 exactly; construct a case landing on .5:
  // gaHandicap 9.5, slope 113 → 9.5 exactly → rounds to 10
  assert.equal(calculateDailyHandicap({ gaHandicap: 9.5, slopeRating: 113 }), 10)
})

test('zero handicap stays zero', () => {
  assert.equal(calculateDailyHandicap({ gaHandicap: 0, slopeRating: 130 }), 0)
})

test('supported plus-handicap (negative GA handicap) behaviour', () => {
  // -2 × 130 / 113 = -2.30 → rounds to -2
  assert.equal(calculateDailyHandicap({ gaHandicap: -2, slopeRating: 130 }), -2)
})

test('missing slope rating throws a typed error', () => {
  assert.throws(
    // @ts-expect-error deliberately omitted for the test
    () => calculateDailyHandicap({ gaHandicap: 10 }),
    (err: unknown) => err instanceof ScoringDomainError && err.code === 'MISSING_SLOPE_RATING'
  )
})

test('invalid (zero or negative) slope rating throws a typed error', () => {
  assert.throws(
    () => calculateDailyHandicap({ gaHandicap: 10, slopeRating: 0 }),
    (err: unknown) => err instanceof ScoringDomainError && err.code === 'INVALID_SLOPE_RATING'
  )
  assert.throws(
    () => calculateDailyHandicap({ gaHandicap: 10, slopeRating: -50 }),
    (err: unknown) => err instanceof ScoringDomainError && err.code === 'INVALID_SLOPE_RATING'
  )
})

test('missing GA handicap throws a typed error', () => {
  assert.throws(
    // @ts-expect-error deliberately omitted for the test
    () => calculateDailyHandicap({ slopeRating: 120 }),
    (err: unknown) => err instanceof ScoringDomainError && err.code === 'MISSING_HANDICAP'
  )
})
