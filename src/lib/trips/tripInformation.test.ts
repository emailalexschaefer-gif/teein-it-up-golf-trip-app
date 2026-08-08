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

// ── computeTripInformationPreview — collapse/expand UX ──────────────────────
import { computeTripInformationPreview } from './tripInformation'

test('preview — a long itinerary is truncated to the first 10 lines and flagged as exceeding', () => {
  const lines = Array.from({ length: 25 }, (_, i) => `Line ${i + 1}`)
  const full = lines.join('\n')
  const preview = computeTripInformationPreview(full, 10)
  assert.equal(preview.exceedsPreview, true)
  assert.equal(preview.text, lines.slice(0, 10).join('\n'))
  assert.equal(preview.text.split('\n').length, 10)
})

test('preview — a short itinerary (under the line limit) is shown in full, not flagged', () => {
  const short = 'Round 1 — Sandhurst\nTee time 8am\n\nBring sunscreen.'
  const preview = computeTripInformationPreview(short, 10)
  assert.equal(preview.exceedsPreview, false)
  assert.equal(preview.text, short)
})

test('preview — exactly at the line limit is not flagged as exceeding (only text genuinely longer than the preview should show the toggle)', () => {
  const exact = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`).join('\n')
  const preview = computeTripInformationPreview(exact, 10)
  assert.equal(preview.exceedsPreview, false)
  assert.equal(preview.text, exact)
})

test('preview — one line over the limit is flagged, preview is exactly maxLines lines', () => {
  const overByOne = Array.from({ length: 11 }, (_, i) => `Line ${i + 1}`).join('\n')
  const preview = computeTripInformationPreview(overByOne, 10)
  assert.equal(preview.exceedsPreview, true)
  assert.equal(preview.text.split('\n').length, 10)
})

test('preview — preserves blank lines, bullets, and emoji within the preview window', () => {
  const withFormatting = [
    '🚌 FRIDAY — ARRIVAL DAY',
    '• 5:00pm Meet at the club',
    '• 5:30pm Bus departs',
    '',
    '🏌️ SATURDAY — ROUND 1',
    '• 7:00am Breakfast',
    'Line 7', 'Line 8', 'Line 9', 'Line 10', 'Line 11 (should be cut)',
  ].join('\n')
  const preview = computeTripInformationPreview(withFormatting, 10)
  assert.equal(preview.exceedsPreview, true)
  assert.match(preview.text, /🚌 FRIDAY/)
  assert.match(preview.text, /• 5:00pm/)
  assert.match(preview.text, /\n\n/) // the blank line survives
  assert.doesNotMatch(preview.text, /Line 11/)
})

test('preview — an empty string is not flagged as exceeding (nothing to collapse)', () => {
  const preview = computeTripInformationPreview('', 10)
  assert.equal(preview.exceedsPreview, false)
  assert.equal(preview.text, '')
})
