import { test } from 'node:test'
import assert from 'node:assert/strict'
import { limitToTopFive, moreTiedText } from './topFive'

const mk = (positions: number[]) => positions.map((position, i) => ({ position, name: `P${i + 1}` }))

test('fewer than five: shows only those players', () => {
  const r = limitToTopFive(mk([1, 2, 3]))
  assert.equal(r.rows.length, 3); assert.equal(r.moreTied, null)
  assert.equal(limitToTopFive(mk([])).rows.length, 0)
})
test('twenty distinct players: exactly five, no note', () => {
  const r = limitToTopFive(mk(Array.from({ length: 20 }, (_, i) => i + 1)))
  assert.deepEqual(r.rows.map(x => x.position), [1, 2, 3, 4, 5]); assert.equal(r.moreTied, null)
})
test('tie crossing fifth place leaves the whole group out and says so (no false rank)', () => {
  const r = limitToTopFive(mk([1, 2, 3, 4, 4, 4, 7, 8]))
  assert.deepEqual(r.rows.map(x => x.position), [1, 2, 3])
  assert.deepEqual(r.moreTied, { position: 4, count: 3 })
})
test('tie that ends exactly on fifth is shown whole', () => {
  const r = limitToTopFive(mk([1, 2, 3, 4, 4, 6, 7]))
  assert.equal(r.rows.length, 5); assert.equal(r.moreTied, null)
})
test('joint leaders larger than five are all shown (never hide winners)', () => {
  const r = limitToTopFive(mk(Array(8).fill(1)))
  assert.equal(r.rows.length, 8)
})
test('input is not mutated and not re-ranked', () => {
  const input = mk([2, 1, 3]); const r = limitToTopFive(input)
  assert.deepEqual(input.map(x => x.position), [2, 1, 3]); assert.deepEqual(r.rows.map(x => x.position), [1, 2, 3])
})
test('moreTiedText ordinals', () => {
  assert.equal(moreTiedText(null), null)
  assert.match(moreTiedText({ position: 4, count: 3 })!, /3 more players tied for 4th/)
  assert.match(moreTiedText({ position: 2, count: 2 })!, /2nd/)
  assert.match(moreTiedText({ position: 3, count: 2 })!, /3rd/)
  assert.match(moreTiedText({ position: 11, count: 2 })!, /11th/)
  assert.match(moreTiedText({ position: 21, count: 2 })!, /21st/)
})
