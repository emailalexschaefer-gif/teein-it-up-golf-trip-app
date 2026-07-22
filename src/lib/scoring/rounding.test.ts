import test from 'node:test'
import assert from 'node:assert/strict'
import { roundHandicap } from './rounding'

test('10.49 rounds down to 10', () => {
  assert.equal(roundHandicap(10.49), 10)
})

test('10.50 rounds UP to 11 (round-half-up, not banker\'s rounding)', () => {
  assert.equal(roundHandicap(10.50), 11)
})

test('10.74 rounds down to 11? no — rounds to 11 since .74 > .5', () => {
  assert.equal(roundHandicap(10.74), 11)
})

test('14.4 rounds to 14 (from the existing defaultHoles.ts examples)', () => {
  assert.equal(roundHandicap(14.4), 14)
})

test('14.5 rounds to 15', () => {
  assert.equal(roundHandicap(14.5), 15)
})

test('22.5 rounds to 23', () => {
  assert.equal(roundHandicap(22.5), 23)
})

test('negative (plus-handicap) values round consistently', () => {
  assert.equal(roundHandicap(-2.5), -2) // rounds toward +Infinity, same convention as positives
  assert.equal(roundHandicap(-2.49), -2)
  assert.equal(roundHandicap(-2.51), -3)
})

test('whole numbers are unaffected', () => {
  assert.equal(roundHandicap(10), 10)
  assert.equal(roundHandicap(0), 0)
})
