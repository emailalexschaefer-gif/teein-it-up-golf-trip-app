import test from 'node:test'
import assert from 'node:assert/strict'
import { checkScorecardCompletion, checkRoundCompletion } from './roundCompletion'

test('checkScorecardCompletion — digital player mid-round is blocked with the normal message', () => {
  const result = checkScorecardCompletion(
    { scoringMethod: 'digital', selfHoleCount: 10, markerHoleCountForSelfHoles: 10, totalHoles: 18 },
    true,
  )
  assert.equal(result.blocked, true)
  assert.equal(result.reason, 'Not every player has finished scoring yet.')
})

test('checkScorecardCompletion — digital player finished but marker still catching up is blocked with the marker message', () => {
  const result = checkScorecardCompletion(
    { scoringMethod: 'digital', selfHoleCount: 18, markerHoleCountForSelfHoles: 15, totalHoles: 18 },
    true,
  )
  assert.equal(result.blocked, true)
  assert.equal(result.reason, 'Some holes are still awaiting marker entries.')
})

test('checkScorecardCompletion — digital player fully finished and reconciled is not blocked', () => {
  const result = checkScorecardCompletion(
    { scoringMethod: 'digital', selfHoleCount: 18, markerHoleCountForSelfHoles: 18, totalHoles: 18 },
    true,
  )
  assert.equal(result.blocked, false)
  assert.equal(result.reason, null)
})

test('checkScorecardCompletion — non-marker-mode digital player is never blocked by the marker check even with zero marker holes', () => {
  const result = checkScorecardCompletion(
    { scoringMethod: 'digital', selfHoleCount: 18, markerHoleCountForSelfHoles: 0, totalHoles: 18 },
    false,
  )
  assert.equal(result.blocked, false)
})

// ── The core of item 10 — the exact distinction the brief requires ──

test('checkScorecardCompletion — paper player with no card entered yet is blocked with the PAPER message, not the digital one', () => {
  const result = checkScorecardCompletion(
    { scoringMethod: 'paper', selfHoleCount: 0, markerHoleCountForSelfHoles: 0, totalHoles: 18 },
    true,
  )
  assert.equal(result.blocked, true)
  assert.equal(result.reason, '✏️ Paper scorecard not yet entered.')
  // Explicitly NOT these — the exact wrong messages item 10 forbids.
  assert.notEqual(result.reason, 'Not every player has finished scoring yet.')
  assert.notEqual(result.reason, 'Some holes are still awaiting marker entries.')
})

test('checkScorecardCompletion — paper player with a fully entered card is not blocked, regardless of marker mode', () => {
  const resultMarkerMode = checkScorecardCompletion(
    { scoringMethod: 'paper', selfHoleCount: 18, markerHoleCountForSelfHoles: 0, totalHoles: 18 },
    true,
  )
  assert.equal(resultMarkerMode.blocked, false)

  const resultNonMarkerMode = checkScorecardCompletion(
    { scoringMethod: 'paper', selfHoleCount: 18, markerHoleCountForSelfHoles: 0, totalHoles: 18 },
    false,
  )
  assert.equal(resultNonMarkerMode.blocked, false)
})

test('checkScorecardCompletion — paper player is never subject to the marker-reconciliation check, even partially entered', () => {
  // 10 of 18 holes entered — still blocked (card not fully entered),
  // but for the PAPER reason, never the marker reason, since a paper
  // player has no marker relationship at all regardless of holes count.
  const result = checkScorecardCompletion(
    { scoringMethod: 'paper', selfHoleCount: 10, markerHoleCountForSelfHoles: 10, totalHoles: 18 },
    true,
  )
  assert.equal(result.blocked, true)
  assert.equal(result.reason, '✏️ Paper scorecard not yet entered.')
})

// ── Full-round scenarios (item 22's Scenario A/B, at the completion-gate level) ──

test('checkRoundCompletion — Scenario A shape (2 digital finished+reconciled, 1 paper outstanding) blocks on the paper reason', () => {
  const result = checkRoundCompletion([
    { scoringMethod: 'digital', selfHoleCount: 18, markerHoleCountForSelfHoles: 18, totalHoles: 18 }, // Alex
    { scoringMethod: 'digital', selfHoleCount: 18, markerHoleCountForSelfHoles: 18, totalHoles: 18 }, // Darren
    { scoringMethod: 'paper', selfHoleCount: 0, markerHoleCountForSelfHoles: 0, totalHoles: 18 },      // Mick
  ], true)
  assert.notEqual(result, null)
  assert.equal(result?.reason, '✏️ Paper scorecard not yet entered.')
})

test('checkRoundCompletion — Scenario A shape once Mick\u2019s card is entered is genuinely ready to close', () => {
  const result = checkRoundCompletion([
    { scoringMethod: 'digital', selfHoleCount: 18, markerHoleCountForSelfHoles: 18, totalHoles: 18 },
    { scoringMethod: 'digital', selfHoleCount: 18, markerHoleCountForSelfHoles: 18, totalHoles: 18 },
    { scoringMethod: 'paper', selfHoleCount: 18, markerHoleCountForSelfHoles: 0, totalHoles: 18 },
  ], true)
  assert.equal(result, null)
})

test('checkRoundCompletion — Scenario B shape (2 digital, 2 paper both outstanding) blocks on the first paper card found', () => {
  const result = checkRoundCompletion([
    { scoringMethod: 'digital', selfHoleCount: 18, markerHoleCountForSelfHoles: 18, totalHoles: 18 }, // Alex
    { scoringMethod: 'digital', selfHoleCount: 18, markerHoleCountForSelfHoles: 18, totalHoles: 18 }, // Darren
    { scoringMethod: 'paper', selfHoleCount: 0, markerHoleCountForSelfHoles: 0, totalHoles: 18 },      // Mick
    { scoringMethod: 'paper', selfHoleCount: 0, markerHoleCountForSelfHoles: 0, totalHoles: 18 },      // John
  ], true)
  assert.notEqual(result, null)
  assert.equal(result?.reason, '✏️ Paper scorecard not yet entered.')
})

test('checkRoundCompletion — Scenario B shape once both paper cards are entered is genuinely ready to close', () => {
  const result = checkRoundCompletion([
    { scoringMethod: 'digital', selfHoleCount: 18, markerHoleCountForSelfHoles: 18, totalHoles: 18 },
    { scoringMethod: 'digital', selfHoleCount: 18, markerHoleCountForSelfHoles: 18, totalHoles: 18 },
    { scoringMethod: 'paper', selfHoleCount: 18, markerHoleCountForSelfHoles: 0, totalHoles: 18 },
    { scoringMethod: 'paper', selfHoleCount: 18, markerHoleCountForSelfHoles: 0, totalHoles: 18 },
  ], true)
  assert.equal(result, null)
})

// ── Shared-Device Two-Player Fix — P0 regression. The exact reported
// scenario: Alex (digital) + Marnie (paper), self_and_marker round,
// both have completed all holes, neither has any marker entries at
// all (since nobody is meant to mark either of them in this mode). ──

test('checkScorecardCompletion — shared-device DIGITAL scorecard is not blocked by missing marker entries (the P0 bug)', () => {
  const result = checkScorecardCompletion(
    { scoringMethod: 'digital', selfHoleCount: 9, markerHoleCountForSelfHoles: 0, totalHoles: 9, isSharedDevice: true },
    true,
  )
  assert.equal(result.blocked, false)
  assert.equal(result.reason, null)
})

test('checkScorecardCompletion — a NON-shared-device digital scorecard is still correctly blocked by missing marker entries', () => {
  // Confirms the fix is scoped to isSharedDevice, not a general
  // loosening of the marker requirement for every digital player.
  const result = checkScorecardCompletion(
    { scoringMethod: 'digital', selfHoleCount: 9, markerHoleCountForSelfHoles: 0, totalHoles: 9, isSharedDevice: false },
    true,
  )
  assert.equal(result.blocked, true)
  assert.equal(result.reason, 'Some holes are still awaiting marker entries.')
})

test('checkRoundCompletion — Alex + Marnie shared-device pair, both complete, round is genuinely ready to close', () => {
  const result = checkRoundCompletion([
    { scoringMethod: 'digital', selfHoleCount: 9, markerHoleCountForSelfHoles: 0, totalHoles: 9, isSharedDevice: true }, // Alex
    { scoringMethod: 'paper', selfHoleCount: 9, markerHoleCountForSelfHoles: 0, totalHoles: 9, isSharedDevice: true },  // Marnie
  ], true)
  assert.equal(result, null)
})

test('checkScorecardCompletion — shared-device digital scorecard still blocks close if genuinely incomplete', () => {
  // isSharedDevice exempts from the MARKER check, never from the
  // underlying "have they actually finished playing" check.
  const result = checkScorecardCompletion(
    { scoringMethod: 'digital', selfHoleCount: 5, markerHoleCountForSelfHoles: 0, totalHoles: 9, isSharedDevice: true },
    true,
  )
  assert.equal(result.blocked, true)
  assert.equal(result.reason, 'Not every player has finished scoring yet.')
})
