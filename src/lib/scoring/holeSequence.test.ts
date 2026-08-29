import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeHolePlayOrder, orderHolesByPlaySequence } from './holeSequence'

test('computeHolePlayOrder — (9, 1) -> 1..9', () => {
  assert.deepEqual(computeHolePlayOrder(9, 1), [1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('computeHolePlayOrder — (9, 10) -> 10..18', () => {
  assert.deepEqual(computeHolePlayOrder(9, 10), [10, 11, 12, 13, 14, 15, 16, 17, 18])
})

test('computeHolePlayOrder — (18, 1) -> 1..18', () => {
  assert.deepEqual(computeHolePlayOrder(18, 1), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18])
})

test('computeHolePlayOrder — (18, 10) -> 10..18, 1..9', () => {
  assert.deepEqual(computeHolePlayOrder(18, 10), [10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('computeHolePlayOrder — hole 9 is the last hole for (9,1), not hole 18', () => {
  const seq = computeHolePlayOrder(9, 1)
  assert.equal(seq[seq.length - 1], 9)
  assert.equal(seq.length, 9)
})

test('computeHolePlayOrder — hole 9 is the last hole for (18,10), hole 18 is NOT last', () => {
  const seq = computeHolePlayOrder(18, 10)
  assert.equal(seq[seq.length - 1], 9)
  assert.notEqual(seq[seq.length - 1], 18)
})

test('computeHolePlayOrder — every physical hole number is unique, none skipped, none duplicated', () => {
  for (const [holes, tee] of [[9, 1], [9, 10], [18, 1], [18, 10]] as [9 | 18, 1 | 10][]) {
    const seq = computeHolePlayOrder(holes, tee)
    assert.equal(seq.length, holes)
    assert.equal(new Set(seq).size, holes, `no duplicates for (${holes}, ${tee})`)
  }
})

test('orderHolesByPlaySequence — reorders a naturally-ascending fetch into play order for (18, 10)', () => {
  // Simulates exactly what a DB fetch with `.order('hole_number')`
  // would hand back — ascending 1..18, regardless of starting tee.
  const ascendingRows = Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, par: 4 }))
  const ordered = orderHolesByPlaySequence(ascendingRows, 18, 10)
  assert.deepEqual(ordered.map(r => r.hole_number), [10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('orderHolesByPlaySequence — (9, 10) is a no-op reorder relative to a physical-hole-number sort, since it is already contiguous', () => {
  const rows = Array.from({ length: 9 }, (_, i) => ({ hole_number: i + 10, par: 4 }))
  const ordered = orderHolesByPlaySequence(rows, 9, 10)
  assert.deepEqual(ordered.map(r => r.hole_number), [10, 11, 12, 13, 14, 15, 16, 17, 18])
})

test('orderHolesByPlaySequence — (18, 1) is unaffected — identical to ascending order', () => {
  const ascendingRows = Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, par: 4 }))
  const ordered = orderHolesByPlaySequence(ascendingRows, 18, 1)
  assert.deepEqual(ordered.map(r => r.hole_number), ascendingRows.map(r => r.hole_number))
})

test('orderHolesByPlaySequence — preserves each row\'s other fields, not just hole_number, through the reorder', () => {
  const rows = [
    { hole_number: 10, par: 5, strokeIndex: 3 },
    { hole_number: 1, par: 3, strokeIndex: 17 },
  ]
  const ordered = orderHolesByPlaySequence(rows, 18, 10)
  assert.equal(ordered[0].par, 5)
  assert.equal(ordered[0].strokeIndex, 3)
})

test('orderHolesByPlaySequence — an unexpected hole_number not in the play sequence is preserved, not dropped', () => {
  const rows = [{ hole_number: 1, par: 4 }, { hole_number: 99, par: 4 }]
  const ordered = orderHolesByPlaySequence(rows, 9, 1)
  assert.equal(ordered.length, 2)
  assert.ok(ordered.some(r => r.hole_number === 99))
})

// Darren field-test fix (Release 1, item 4) — "final played hole" tests.
// SelfMarkerScoreShell's forward-navigation resolves the final hole as
// `holeIdx >= holes.length - 1` against this exact sequence (never
// hole_number === 18), so what matters is that computeHolePlayOrder's
// LAST entry is the correct physical hole for each configuration — that
// is the actual final-hole resolution this feature depends on.
test('final played hole — 9 holes from 1st tee ends on hole 9', () => {
  const seq = computeHolePlayOrder(9, 1)
  assert.equal(seq[seq.length - 1], 9)
})

test('final played hole — 9 holes from 10th tee ends on hole 18', () => {
  const seq = computeHolePlayOrder(9, 10)
  assert.equal(seq[seq.length - 1], 18)
})

test('final played hole — 18 holes from 1st tee ends on hole 18', () => {
  const seq = computeHolePlayOrder(18, 1)
  assert.equal(seq[seq.length - 1], 18)
})

test('final played hole — 18 holes from 10th tee ends on hole 9, not hole 18', () => {
  const seq = computeHolePlayOrder(18, 10)
  assert.equal(seq[seq.length - 1], 9)
  assert.notEqual(seq[seq.length - 1], 18)
})
