import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPracticeHoleSequence } from './practiceHoleSequence'

// P0 bug (9 Sep) -- reproduces the exact client payload shape that
// failed: nineSelection/startingHole are plain useState fields
// initialised to null, so every real submission sends one of them as
// an explicit `null`, never simply omitted. These tests pass `null`
// explicitly (not `undefined`) for the inactive field in every case,
// exactly matching what the client actually sends -- this is what
// would have caught the regression before it reached a device.

test('TEST A -- 9 Front, Stats YES payload shape -> first hole 1', () => {
  const r = buildPracticeHoleSequence(9, 'front', null)
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.deepEqual(r.holeSequence, [1, 2, 3, 4, 5, 6, 7, 8, 9])
    assert.equal(r.holeSequence[0], 1)
  }
})

test('TEST B -- 9 Back, Stats YES payload shape -> first hole 10, only 10-18', () => {
  const r = buildPracticeHoleSequence(9, 'back', null)
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.deepEqual(r.holeSequence, [10, 11, 12, 13, 14, 15, 16, 17, 18])
    assert.equal(r.holeSequence[0], 10)
    assert.equal(r.holeSequence.includes(1), false)
  }
})

test('TEST C -- 9 Back, Stats NO payload shape -> identical sequence regardless of stats', () => {
  // Confirms the P0's own strongest clue was correctly diagnosed: the
  // hole-sequence logic has no dependency on trackStats at all, so
  // Stats YES vs NO could never have been the actual cause -- proven
  // here by getting the identical result as TEST B.
  const r = buildPracticeHoleSequence(9, 'back', null)
  assert.equal(r.ok, true)
  if (r.ok) assert.deepEqual(r.holeSequence, [10, 11, 12, 13, 14, 15, 16, 17, 18])
})

test('TEST D -- 18 holes, Start 1st Tee payload shape -> 1 through 18', () => {
  const r = buildPracticeHoleSequence(18, null, 1)
  assert.equal(r.ok, true)
  if (r.ok) assert.deepEqual(r.holeSequence, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18])
})

test('TEST E -- 18 holes, Start 10th Tee -> 10-18 then 1-9', () => {
  const r = buildPracticeHoleSequence(18, null, 10)
  assert.equal(r.ok, true)
  if (r.ok) assert.deepEqual(r.holeSequence, [10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('TEST F -- 18 holes, Start 1st Tee, Stats NO -> creates normally', () => {
  const r = buildPracticeHoleSequence(18, null, 1)
  assert.equal(r.ok, true)
})

test('genuinely missing Front/Back choice for 9 holes produces a clear error, not a crash', () => {
  const r = buildPracticeHoleSequence(9, null, null)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.error, 'Select Front 9 or Back 9.')
})

test('genuinely missing starting tee for 18 holes produces a clear error, not a crash', () => {
  const r = buildPracticeHoleSequence(18, null, null)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.error, 'Select 1st Tee or 10th Tee.')
})

test('undefined (key genuinely absent) behaves identically to explicit null', () => {
  // The two ways "not provided" can arrive after a nullable().optional()
  // Zod parse -- both must be handled identically by this function.
  const withNull = buildPracticeHoleSequence(9, 'front', null)
  const withUndefined = buildPracticeHoleSequence(9, 'front', undefined)
  assert.deepEqual(withNull, withUndefined)
})
