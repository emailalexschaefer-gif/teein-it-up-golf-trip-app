import test from 'node:test'
import assert from 'node:assert/strict'
import { validateTripInformation, TRIP_INFORMATION_MAX_LENGTH } from './tripInformation'

test('null is valid and normalises to null (the empty state)', () => {
  const result = validateTripInformation(null)
  assert.equal(result.ok, true)
  assert.equal(result.normalised, null)
})

test('a normal pasted itinerary passes through unchanged, preserving line breaks', () => {
  const pasted = 'Round 1 — Sandhurst Champions\nTee time 8:04am\n\nAccommodation:\n- The Lodge, check-in 2pm'
  const result = validateTripInformation(pasted)
  assert.equal(result.ok, true)
  assert.equal(result.normalised, pasted)
})

test('an empty string normalises to null, not stored as empty text', () => {
  const result = validateTripInformation('')
  assert.equal(result.ok, true)
  assert.equal(result.normalised, null)
})

test('a whitespace-only string (e.g. deleted content) normalises to null', () => {
  const result = validateTripInformation('   \n\n  \t  ')
  assert.equal(result.ok, true)
  assert.equal(result.normalised, null)
})

test('a non-string, non-null value is rejected', () => {
  const result = validateTripInformation(12345)
  assert.equal(result.ok, false)
  assert.match(result.error ?? '', /string or null/)
})

test('text at exactly the length limit is accepted', () => {
  const atLimit = 'a'.repeat(TRIP_INFORMATION_MAX_LENGTH)
  const result = validateTripInformation(atLimit)
  assert.equal(result.ok, true)
  assert.equal(result.normalised, atLimit)
})

test('text over the length limit is rejected with a clear message', () => {
  const tooLong = 'a'.repeat(TRIP_INFORMATION_MAX_LENGTH + 1)
  const result = validateTripInformation(tooLong)
  assert.equal(result.ok, false)
  assert.match(result.error ?? '', /too long/)
})
