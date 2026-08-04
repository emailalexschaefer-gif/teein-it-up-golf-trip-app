import test from 'node:test'
import assert from 'node:assert/strict'
import { getDefaultHolesForNine, DEFAULT_9_HOLES, DEFAULT_9_BACK_HOLES, DEFAULT_18_HOLES } from './defaultHoles'

test('Front Nine template covers hole numbers 1-9', () => {
  const holes = getDefaultHolesForNine('front')
  assert.deepEqual(holes.map(h => h.hole_number).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('Back Nine template covers real hole numbers 10-18, not renumbered to 1-9', () => {
  const holes = getDefaultHolesForNine('back')
  assert.deepEqual(holes.map(h => h.hole_number).sort((a, b) => a - b), [10, 11, 12, 13, 14, 15, 16, 17, 18])
})

test('Back Nine template is derived from the same 18-hole template, not separately invented data', () => {
  const holes = getDefaultHolesForNine('back')
  const expected = DEFAULT_18_HOLES.filter(h => h.hole_number > 9)
  assert.deepEqual(holes, expected)
})

test('Custom defaults to the Front Nine template as an editable starting point', () => {
  const holes = getDefaultHolesForNine('custom')
  assert.deepEqual(holes, DEFAULT_9_HOLES)
})

test('Front and Back Nine templates each have unique hole numbers and unique stroke indexes', () => {
  for (const template of [DEFAULT_9_HOLES, DEFAULT_9_BACK_HOLES]) {
    const holeNumbers = template.map(h => h.hole_number)
    const strokeIndexes = template.map(h => h.stroke_index)
    assert.equal(new Set(holeNumbers).size, holeNumbers.length)
    assert.equal(new Set(strokeIndexes).size, strokeIndexes.length)
  }
})

test('getDefaultHolesForNine returns a fresh copy each call, not a shared mutable reference', () => {
  const a = getDefaultHolesForNine('front')
  const b = getDefaultHolesForNine('front')
  a[0].par = 99
  assert.notEqual(b[0].par, 99)
})
