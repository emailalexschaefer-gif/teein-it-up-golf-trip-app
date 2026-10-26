import test from 'node:test'
import assert from 'node:assert/strict'
import { parCoverage, PAR_COVERAGE_WARNING } from './holeOptionLabel'
const snap18 = Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, par: i % 3 === 0 ? 5 : 4 }))
test('par coverage: complete when every playable hole has its own par; back nine uses holes 10-18', () => {
  assert.equal(parCoverage([1, 2, 3, 4, 5, 6, 7, 8, 9], snap18), 'complete')
  assert.equal(parCoverage([10, 11, 12, 13, 14, 15, 16, 17, 18], snap18), 'complete')
})
test('par coverage: no snapshot -> none, a front-nine-only snapshot on a back-nine round -> none, gaps -> partial', () => {
  assert.equal(parCoverage([1, 2, 3], null), 'none')
  assert.equal(parCoverage([1, 2, 3], []), 'none')
  assert.equal(parCoverage([10, 11, 12], snap18.slice(0, 9)), 'none')
  assert.equal(parCoverage([8, 9, 10], snap18.slice(0, 9)), 'partial')
  assert.equal(parCoverage([1, 2], [{ hole_number: 1, par: 4 }, { hole_number: 2, par: 0 }]), 'partial')
  assert.equal(parCoverage([], snap18), 'none')
})
test('the missing-course warning guides the organiser and never invents a par', () => {
  assert.match(PAR_COVERAGE_WARNING, /Course Library/)
  assert.doesNotMatch(PAR_COVERAGE_WARNING, /Par \d/)
})
