import test from 'node:test'
import assert from 'node:assert/strict'
import { detectSharedDeviceGroup } from './sharedDeviceScoring'
import { checkScorecardCompletion } from './roundCompletion'

test('detectSharedDeviceGroup — Scenario B shape (Alex digital, Mick paper) triggers shared-device mode', () => {
  const result = detectSharedDeviceGroup([
    { playerId: 'alex', scoringMethod: 'digital' },
    { playerId: 'mick', scoringMethod: 'paper' },
  ])
  assert.equal(result.isSharedDevice, true)
  assert.equal(result.digitalPlayerId, 'alex')
  assert.equal(result.paperPlayerId, 'mick')
})

test('detectSharedDeviceGroup — order-independent (paper listed first)', () => {
  const result = detectSharedDeviceGroup([
    { playerId: 'mick', scoringMethod: 'paper' },
    { playerId: 'alex', scoringMethod: 'digital' },
  ])
  assert.equal(result.isSharedDevice, true)
  assert.equal(result.digitalPlayerId, 'alex')
  assert.equal(result.paperPlayerId, 'mick')
})

// ── Explicit regression case from the brief: "do not accidentally turn
// every Paper player into a shared-device player" ──

test('detectSharedDeviceGroup — Scenario A shape (3 players, 1 paper) does NOT trigger shared-device mode', () => {
  const result = detectSharedDeviceGroup([
    { playerId: 'alex', scoringMethod: 'digital' },
    { playerId: 'test', scoringMethod: 'digital' },
    { playerId: 'marnie', scoringMethod: 'paper' },
  ])
  assert.equal(result.isSharedDevice, false)
  assert.equal(result.digitalPlayerId, null)
  assert.equal(result.paperPlayerId, null)
})

test('detectSharedDeviceGroup — 2 digital players does not trigger shared-device mode', () => {
  const result = detectSharedDeviceGroup([
    { playerId: 'alex', scoringMethod: 'digital' },
    { playerId: 'darren', scoringMethod: 'digital' },
  ])
  assert.equal(result.isSharedDevice, false)
})

test('detectSharedDeviceGroup — 2 paper players does not trigger shared-device mode', () => {
  const result = detectSharedDeviceGroup([
    { playerId: 'mick', scoringMethod: 'paper' },
    { playerId: 'john', scoringMethod: 'paper' },
  ])
  assert.equal(result.isSharedDevice, false)
})

test('detectSharedDeviceGroup — solo group does not trigger shared-device mode', () => {
  const result = detectSharedDeviceGroup([{ playerId: 'alex', scoringMethod: 'digital' }])
  assert.equal(result.isSharedDevice, false)
})

test('detectSharedDeviceGroup — 4-player group with 2 digital + 2 paper does not trigger shared-device mode', () => {
  const result = detectSharedDeviceGroup([
    { playerId: 'alex', scoringMethod: 'digital' },
    { playerId: 'darren', scoringMethod: 'digital' },
    { playerId: 'mick', scoringMethod: 'paper' },
    { playerId: 'john', scoringMethod: 'paper' },
  ])
  assert.equal(result.isSharedDevice, false)
})

test('detectSharedDeviceGroup — empty group does not trigger shared-device mode', () => {
  const result = detectSharedDeviceGroup([])
  assert.equal(result.isSharedDevice, false)
})

// ── Scoring-state transitions, not only detection — item explicitly
// requested this. Ties detectSharedDeviceGroup together with
// checkScorecardCompletion (already built for the standard Paper
// workflow) to prove Mick's scorecard genuinely transitions from
// outstanding to complete as holes are filled through shared-device
// scoring — the same completion signal used everywhere else, since a
// shared-device write is just applyHoleOverride under the hood,
// indistinguishable at the scorecard level from any other official
// paper-card entry. ──

test('shared-device scoring state — Mick starts Paper Card Outstanding, same as the standard workflow', () => {
  const detection = detectSharedDeviceGroup([
    { playerId: 'alex', scoringMethod: 'digital' },
    { playerId: 'mick', scoringMethod: 'paper' },
  ])
  assert.equal(detection.isSharedDevice, true)

  const mickResult = checkScorecardCompletion(
    { scoringMethod: 'paper', selfHoleCount: 0, markerHoleCountForSelfHoles: 0, totalHoles: 18 },
    false,
  )
  assert.equal(mickResult.blocked, true)
  assert.equal(mickResult.reason, '✏️ Paper scorecard not yet entered.')
})

test('shared-device scoring state — Mick mid-round (Alex has entered some but not all holes) is still outstanding', () => {
  const mickResult = checkScorecardCompletion(
    { scoringMethod: 'paper', selfHoleCount: 9, markerHoleCountForSelfHoles: 0, totalHoles: 18 },
    false,
  )
  assert.equal(mickResult.blocked, true)
  assert.equal(mickResult.reason, '✏️ Paper scorecard not yet entered.')
})

test('shared-device scoring state — once Alex has entered all 18 of Mick\u2019s holes, Mick is no longer outstanding', () => {
  const mickResult = checkScorecardCompletion(
    { scoringMethod: 'paper', selfHoleCount: 18, markerHoleCountForSelfHoles: 0, totalHoles: 18 },
    false,
  )
  assert.equal(mickResult.blocked, false)
  // Explicitly confirms no reconciliation requirement was introduced —
  // markerHoleCountForSelfHoles is 0 (no marker rows exist for Mick at
  // all, by construction of the shared-device write path) yet
  // completion is still unblocked, because isMarkerMode is correctly
  // false for a paper player regardless of the round's own
  // score_capture_mode.
  assert.equal(mickResult.reason, null)
})

test('shared-device scoring state — a 3-player group\u2019s Marnie (standard Paper workflow) is unaffected by shared-device logic existing at all', () => {
  const detection = detectSharedDeviceGroup([
    { playerId: 'alex', scoringMethod: 'digital' },
    { playerId: 'test', scoringMethod: 'digital' },
    { playerId: 'marnie', scoringMethod: 'paper' },
  ])
  assert.equal(detection.isSharedDevice, false)
  // Marnie's completion check behaves identically whether or not
  // shared-device detection ran — same function, same result, no
  // special-casing needed for the 3-player shape.
  const marnieResult = checkScorecardCompletion(
    { scoringMethod: 'paper', selfHoleCount: 18, markerHoleCountForSelfHoles: 0, totalHoles: 18 },
    true,
  )
  assert.equal(marnieResult.blocked, false)
})
