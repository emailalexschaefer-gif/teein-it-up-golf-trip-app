import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calculatePracticeStats, type PracticeHoleInput } from './practiceStats'

function hole(overrides: Partial<PracticeHoleInput> & { holeNumber: number; par: number }): PracticeHoleInput {
  return {
    grossScore: null, pickedUp: false, stablefordPts: null,
    fairwayHit: null, gir: null, putts: null,
    ...overrides,
  }
}

test('unanswered fairway/GIR are never counted as misses', () => {
  const holes = [
    hole({ holeNumber: 1, par: 4, grossScore: 5, stablefordPts: 3, fairwayHit: true, gir: true, putts: 2 }),
    hole({ holeNumber: 2, par: 4, grossScore: 4, stablefordPts: 4 }), // scored, but no stats answered at all
  ]
  const r = calculatePracticeStats(holes)
  assert.equal(r.fairwaysEligible, 2)
  assert.equal(r.fairwaysAnswered, 1)
  assert.equal(r.fairwaysHit, 1)
  assert.equal(r.fairwayPct, 100) // NOT 50% — hole 2 was never answered, not a miss
  assert.equal(r.girAnswered, 1)
  assert.equal(r.girPct, 100)
  assert.equal(r.puttsAnswered, 1)
  assert.equal(r.puttsPerHole, 2)
})

test('par 3 never counts as a fairway opportunity', () => {
  const holes = [
    hole({ holeNumber: 1, par: 3, grossScore: 3, stablefordPts: 4, gir: true, putts: 1 }),
  ]
  const r = calculatePracticeStats(holes)
  assert.equal(r.fairwaysEligible, 0)
  assert.equal(r.fairwaysAnswered, 0)
  assert.equal(r.fairwayPct, null) // never 0% — genuinely no opportunity existed
})

test('no answered stats at all yields null percentages, not 0%', () => {
  const holes = [
    hole({ holeNumber: 1, par: 4, grossScore: 5, stablefordPts: 3 }),
    hole({ holeNumber: 2, par: 5, grossScore: 6, stablefordPts: 2 }),
  ]
  const r = calculatePracticeStats(holes)
  assert.equal(r.fairwayPct, null)
  assert.equal(r.girPct, null)
  assert.equal(r.puttsPerHole, null)
  assert.equal(r.totalPutts, 0)
})

test('holesCompleted counts a picked-up hole but not gross/Stableford from it', () => {
  const holes = [
    hole({ holeNumber: 1, par: 4, pickedUp: true, stablefordPts: 0 }),
    hole({ holeNumber: 2, par: 4, grossScore: 5, stablefordPts: 3 }),
  ]
  const r = calculatePracticeStats(holes)
  assert.equal(r.holesCompleted, 2)
  assert.equal(r.grossTotal, 5) // pickup contributes no gross stroke count
  assert.equal(r.stablefordTotal, 3)
})

test('an unplayed hole does not count toward holesCompleted even if stats were somehow entered', () => {
  const holes = [
    hole({ holeNumber: 1, par: 4, fairwayHit: true, gir: false, putts: 2 }), // no score at all yet
  ]
  const r = calculatePracticeStats(holes)
  assert.equal(r.holesCompleted, 0)
  assert.equal(r.fairwaysAnswered, 1) // stat-answering is independent of scoring completion
  assert.equal(r.fairwayPct, 100)
})

test('mixed real example matches expected fairway/GIR/putts percentages', () => {
  const holes = [
    hole({ holeNumber: 1, par: 4, grossScore: 5, stablefordPts: 3, fairwayHit: true, gir: true, putts: 2 }),
    hole({ holeNumber: 2, par: 4, grossScore: 6, stablefordPts: 2, fairwayHit: false, gir: false, putts: 3 }),
    hole({ holeNumber: 3, par: 3, grossScore: 4, stablefordPts: 2, gir: true, putts: 1 }),
    hole({ holeNumber: 4, par: 5, grossScore: 6, stablefordPts: 3 }), // no stats answered
  ]
  const r = calculatePracticeStats(holes)
  assert.equal(r.holesCompleted, 4)
  assert.equal(r.grossTotal, 21)
  assert.equal(r.stablefordTotal, 10)
  assert.equal(r.fairwaysEligible, 3) // holes 1, 2, 4
  assert.equal(r.fairwaysAnswered, 2) // holes 1, 2 — hole 4 unanswered
  assert.equal(r.fairwaysHit, 1)
  assert.equal(r.fairwayPct, 50)
  assert.equal(r.girAnswered, 3)
  assert.equal(r.girHit, 2)
  assert.equal(r.girPct, 67)
  assert.equal(r.puttsAnswered, 3)
  assert.equal(r.totalPutts, 6)
  assert.equal(r.puttsPerHole, 2)
})
