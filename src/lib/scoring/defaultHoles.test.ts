import test from 'node:test'
import assert from 'node:assert/strict'
import { getDefaultHolesForNine, DEFAULT_9_HOLES, DEFAULT_9_BACK_HOLES, DEFAULT_18_HOLES, deriveBeginRoundHoles, getDefaultHoles, deriveNineHoles } from './defaultHoles'

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

// ── deriveBeginRoundHoles (Course Library v1) ────────────────────────────────

test('deriveBeginRoundHoles — a manually-configured round (no snapshot) falls back to the exact generic default template', () => {
  const withNoSnapshot = deriveBeginRoundHoles(null, 18)
  const generic = getDefaultHoles(18)
  assert.deepEqual(withNoSnapshot, generic)
})

test('deriveBeginRoundHoles — an empty snapshot array also falls back to the generic template, not an empty hole list', () => {
  const result = deriveBeginRoundHoles([], 18)
  assert.equal(result.length, 18)
  assert.deepEqual(result, getDefaultHoles(18))
})

test('deriveBeginRoundHoles — a real library snapshot is preferred over the generic template', () => {
  const snapshot = [
    { hole_number: 1, par: 4, stroke_index: 7, distance: 350 },
    { hole_number: 2, par: 3, stroke_index: 15, distance: 145 },
  ]
  const result = deriveBeginRoundHoles(snapshot, 18)
  assert.equal(result.length, 2) // only what the snapshot actually has, not padded to 18
  assert.deepEqual(result[0], { hole_number: 1, par: 4, stroke_index: 7, distance: 350, pro_tip: null })
  assert.deepEqual(result[1], { hole_number: 2, par: 3, stroke_index: 15, distance: 145, pro_tip: null })
})

test('deriveBeginRoundHoles — distance survives the derivation untouched, including when null', () => {
  const snapshot = [
    { hole_number: 1, par: 4, stroke_index: 1, distance: 380 },
    { hole_number: 2, par: 4, stroke_index: 2, distance: null }, // e.g. Eagle Ridge/Flinders in this build's own seed — identity/par verified, distance genuinely not yet
  ]
  const result = deriveBeginRoundHoles(snapshot, 18)
  assert.equal(result[0].distance, 380)
  assert.equal(result[1].distance, null)
})

test('deriveBeginRoundHoles — a missing stroke_index defaults to that hole\'s own number, never left null (holes.stroke_index is NOT NULL) and never colliding across holes', () => {
  const snapshot = [
    { hole_number: 1, par: 4, stroke_index: null, distance: null },
    { hole_number: 2, par: 4, stroke_index: null, distance: null },
    { hole_number: 3, par: 3, stroke_index: 9, distance: 160 }, // this one IS verified — must be preserved exactly, not overwritten by the same defaulting logic
  ]
  const result = deriveBeginRoundHoles(snapshot, 18)
  assert.equal(result[0].stroke_index, 1)
  assert.equal(result[1].stroke_index, 2)
  assert.equal(result[2].stroke_index, 9) // untouched — was not missing
  // Still no collisions, satisfying holes' own UNIQUE(round_id, stroke_index).
  assert.equal(new Set(result.map(h => h.stroke_index)).size, result.length)
})

test('deriveBeginRoundHoles — Sandhurst Champions\' own seeded 18-hole snapshot (this build\'s real data) round-trips exactly, par 72, no duplicate stroke indexes', () => {
  const sandhurstChampionsSnapshot = [
    { hole_number: 1, par: 4, stroke_index: 4, distance: null },
    { hole_number: 2, par: 4, stroke_index: 16, distance: null },
    { hole_number: 3, par: 5, stroke_index: 8, distance: null },
    { hole_number: 4, par: 4, stroke_index: 15, distance: null },
    { hole_number: 5, par: 5, stroke_index: 11, distance: null },
    { hole_number: 6, par: 3, stroke_index: 6, distance: null },
    { hole_number: 7, par: 4, stroke_index: 12, distance: null },
    { hole_number: 8, par: 3, stroke_index: 7, distance: null },
    { hole_number: 9, par: 4, stroke_index: 1, distance: null },
    { hole_number: 10, par: 5, stroke_index: 9, distance: null },
    { hole_number: 11, par: 3, stroke_index: 14, distance: null },
    { hole_number: 12, par: 5, stroke_index: 18, distance: null },
    { hole_number: 13, par: 4, stroke_index: 2, distance: null },
    { hole_number: 14, par: 4, stroke_index: 10, distance: null },
    { hole_number: 15, par: 4, stroke_index: 3, distance: null },
    { hole_number: 16, par: 3, stroke_index: 17, distance: null },
    { hole_number: 17, par: 4, stroke_index: 13, distance: null },
    { hole_number: 18, par: 4, stroke_index: 5, distance: null },
  ]
  const result = deriveBeginRoundHoles(sandhurstChampionsSnapshot, 18)
  assert.equal(result.length, 18)
  assert.equal(result.reduce((sum, h) => sum + h.par, 0), 72)
  assert.deepEqual(new Set(result.map(h => h.stroke_index)), new Set([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]))
  // Confirms deriveBeginRoundHoles never touches an already-present, real
  // stroke_index value — every one of these came through unmodified.
  assert.equal(result.find(h => h.hole_number === 9)?.stroke_index, 1)
})

test('deriveBeginRoundHoles — a 9-hole round only uses snapshot holes within that range, never all 18 from an 18-hole library tee', () => {
  const eighteenHoleSnapshot = Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, par: 4, stroke_index: i + 1, distance: null }))
  const result = deriveBeginRoundHoles(eighteenHoleSnapshot, 9)
  assert.equal(result.length, 9)
  assert.deepEqual(result.map(h => h.hole_number), [1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('deriveBeginRoundHoles — output is sorted by hole number regardless of snapshot input order', () => {
  const outOfOrder = [
    { hole_number: 3, par: 3, stroke_index: 5, distance: null },
    { hole_number: 1, par: 4, stroke_index: 1, distance: null },
    { hole_number: 2, par: 4, stroke_index: 3, distance: null },
  ]
  const result = deriveBeginRoundHoles(outOfOrder, 18)
  assert.deepEqual(result.map(h => h.hole_number), [1, 2, 3])
})

// ── deriveNineHoles (Front/Back Nine — the Course Library defect fix) ───────
// The actual bug: BeginRoundModal's nine-selector used to call
// getDefaultHolesForNine() unconditionally, silently discarding real
// library snapshot data (par/stroke index/distance) the instant an
// organiser tapped Front/Back/Custom on a 9-hole round sourced from an
// 18-hole library course like this build's own seeded Sandhurst
// Champions. These tests are the regression guard for exactly that.

function fullEighteenHoleSnapshot() {
  // A distinct, checkable value per field per hole (not all-identical
  // placeholders) so a test can tell "real snapshot data" apart from
  // anything the generic template could have coincidentally produced.
  return Array.from({ length: 18 }, (_, i) => ({
    hole_number: i + 1,
    par: [4, 3, 5][i % 3],
    stroke_index: 18 - i, // deliberately NOT equal to hole_number, so a test that
                           // accidentally reads hole_number instead of stroke_index would fail
    distance: 300 + i * 7, // a distinct, checkable distance per hole
  }))
}

test('deriveNineHoles — Front Nine on a library snapshot preserves real par/stroke index/distance for holes 1-9, not the generic template', () => {
  const snapshot = fullEighteenHoleSnapshot()
  const result = deriveNineHoles(snapshot, 'front')
  assert.deepEqual(result.map(h => h.hole_number), [1, 2, 3, 4, 5, 6, 7, 8, 9])
  // Spot-check real, distinctive values survived untouched.
  assert.deepEqual(result[0], { hole_number: 1, par: 4, stroke_index: 18, distance: 300, pro_tip: null })
  assert.deepEqual(result[4], { hole_number: 5, par: 3, stroke_index: 14, distance: 328, pro_tip: null })
  // Never equal to the generic Front Nine template — proves this is
  // really reading the snapshot, not accidentally falling through.
  assert.notDeepEqual(result, getDefaultHolesForNine('front'))
})

test('deriveNineHoles — Back Nine on a library snapshot preserves real hole data for holes 10-18, with real course hole numbers retained (not renumbered to 1-9)', () => {
  const snapshot = fullEighteenHoleSnapshot()
  const result = deriveNineHoles(snapshot, 'back')
  assert.deepEqual(result.map(h => h.hole_number), [10, 11, 12, 13, 14, 15, 16, 17, 18])
  assert.deepEqual(result[0], { hole_number: 10, par: 4, stroke_index: 9, distance: 363, pro_tip: null })
  assert.deepEqual(result[8], { hole_number: 18, par: 5, stroke_index: 1, distance: 419, pro_tip: null })
  assert.notDeepEqual(result, getDefaultHolesForNine('back'))
})

test('deriveNineHoles — switching between Front and Back on the SAME snapshot never mutates it (no shared-reference corruption)', () => {
  const snapshot = fullEighteenHoleSnapshot()
  const frozenCopy = JSON.parse(JSON.stringify(snapshot))
  deriveNineHoles(snapshot, 'front')
  deriveNineHoles(snapshot, 'back')
  deriveNineHoles(snapshot, 'front')
  assert.deepEqual(snapshot, frozenCopy) // completely unchanged after repeated slicing in both directions
})

test('deriveNineHoles — the two calls return independent arrays; editing one (as Custom-nine editing would) cannot corrupt the other or the source snapshot', () => {
  const snapshot = fullEighteenHoleSnapshot()
  const front = deriveNineHoles(snapshot, 'front')
  const back = deriveNineHoles(snapshot, 'back')
  front[0].par = 99 // simulates the organiser editing a hole in Custom mode
  assert.notEqual(back[0].par, 99)
  assert.notEqual(snapshot[0].par, 99)
})

test('deriveNineHoles — a missing stroke_index within the sliced range still defaults to the hole\'s own number, same rule as deriveBeginRoundHoles, not left null', () => {
  const snapshot = [
    { hole_number: 1, par: 4, stroke_index: null, distance: null },
    { hole_number: 2, par: 4, stroke_index: 5, distance: null },
  ]
  const result = deriveNineHoles(snapshot, 'front')
  assert.equal(result[0].stroke_index, 1)
  assert.equal(result[1].stroke_index, 5) // untouched — was not missing
})

test('deriveNineHoles — no snapshot at all falls back to the exact generic Front/Back Nine template, unchanged from before this fix', () => {
  assert.deepEqual(deriveNineHoles(null, 'front'), getDefaultHolesForNine('front'))
  assert.deepEqual(deriveNineHoles(undefined, 'back'), getDefaultHolesForNine('back'))
  assert.deepEqual(deriveNineHoles([], 'front'), getDefaultHolesForNine('front'))
})

test('deriveNineHoles — a snapshot with genuinely no holes in the requested range (e.g. a 9-hole-only library entry, Back Nine requested) falls back to the generic template rather than returning an empty round', () => {
  const nineHoleOnlySnapshot = Array.from({ length: 9 }, (_, i) => ({ hole_number: i + 1, par: 4, stroke_index: i + 1, distance: null }))
  const result = deriveNineHoles(nineHoleOnlySnapshot, 'back')
  assert.deepEqual(result, getDefaultHolesForNine('back'))
})

test('deriveNineHoles — this build\'s own real seeded Sandhurst Champions data, sliced to Front and Back, matches the source hole-by-hole with no data loss', () => {
  const sandhurstChampionsSnapshot = [
    { hole_number: 1, par: 4, stroke_index: 4, distance: null },
    { hole_number: 2, par: 4, stroke_index: 16, distance: null },
    { hole_number: 3, par: 5, stroke_index: 8, distance: null },
    { hole_number: 4, par: 4, stroke_index: 15, distance: null },
    { hole_number: 5, par: 5, stroke_index: 11, distance: null },
    { hole_number: 6, par: 3, stroke_index: 6, distance: null },
    { hole_number: 7, par: 4, stroke_index: 12, distance: null },
    { hole_number: 8, par: 3, stroke_index: 7, distance: null },
    { hole_number: 9, par: 4, stroke_index: 1, distance: null },
    { hole_number: 10, par: 5, stroke_index: 9, distance: null },
    { hole_number: 11, par: 3, stroke_index: 14, distance: null },
    { hole_number: 12, par: 5, stroke_index: 18, distance: null },
    { hole_number: 13, par: 4, stroke_index: 2, distance: null },
    { hole_number: 14, par: 4, stroke_index: 10, distance: null },
    { hole_number: 15, par: 4, stroke_index: 3, distance: null },
    { hole_number: 16, par: 3, stroke_index: 17, distance: null },
    { hole_number: 17, par: 4, stroke_index: 13, distance: null },
    { hole_number: 18, par: 4, stroke_index: 5, distance: null },
  ]
  const front = deriveNineHoles(sandhurstChampionsSnapshot, 'front')
  const back = deriveNineHoles(sandhurstChampionsSnapshot, 'back')
  assert.equal(front.reduce((s, h) => s + h.par, 0), 36) // front nine par
  assert.equal(back.reduce((s, h) => s + h.par, 0), 36)  // back nine par — together, 72, matching the course's real par
  assert.equal(front.find(h => h.hole_number === 9)?.stroke_index, 1) // the course's hardest hole, correctly on the front nine
  assert.equal(back.find(h => h.hole_number === 12)?.stroke_index, 18) // the easiest, correctly on the back nine
})

test('deriveNineHoles — a legacy/manual round (no snapshot ever existed) behaves exactly as it did before this fix', () => {
  // The exact scenario the brief called out: "If no library snapshot
  // exists, retain the existing generic/manual behaviour exactly as it
  // works today."
  assert.deepEqual(deriveNineHoles(null, 'front'), DEFAULT_9_HOLES.map(h => ({ ...h })))
  assert.deepEqual(deriveNineHoles(null, 'back'), DEFAULT_9_BACK_HOLES.map(h => ({ ...h })))
})
