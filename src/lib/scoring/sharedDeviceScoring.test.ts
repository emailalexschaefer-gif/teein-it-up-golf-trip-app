import test from 'node:test'
import assert from 'node:assert/strict'
import { detectSharedDeviceGroup, resolveMarkedPlayerId, resolveSideCompVerifierCandidate } from './sharedDeviceScoring'
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

// ─────────────────────────────────────────────────────────────────────────
// Live Scoring Stabilisation brief (1 Sep) — P1, "protect the paper-
// player polling fix." resolveMarkedPlayerId is the exact decision that
// was previously duplicated (correctly in page.tsx, incorrectly/absent
// in /my-scores) — these tests cover the 5 scenarios the brief
// explicitly asked for, against the single shared function both routes
// now call.
// ─────────────────────────────────────────────────────────────────────────

test('resolveMarkedPlayerId — shared-device Paper Player is returned on initial resolution', () => {
  const detection = detectSharedDeviceGroup([
    { playerId: 'alex', scoringMethod: 'digital' },
    { playerId: 'test', scoringMethod: 'paper' },
  ])
  const result = resolveMarkedPlayerId({
    myUserId: 'alex',
    sharedDeviceDetection: detection,
    usesMarkers: true, // self_and_marker mode — must not matter; shared-device still wins
    markerRows: [],
  })
  assert.equal(result.markedPlayerId, 'test')
  assert.equal(result.isSharedDevice, true)
})

test('resolveMarkedPlayerId — repeated calls with identical input retain the same Paper Player (the exact P0 regression)', () => {
  const detection = detectSharedDeviceGroup([
    { playerId: 'alex', scoringMethod: 'digital' },
    { playerId: 'test', scoringMethod: 'paper' },
  ])
  const params = { myUserId: 'alex', sharedDeviceDetection: detection, usesMarkers: true, markerRows: [] }
  // This is the exact bug: the pre-fix /my-scores route would return
  // 'test' on the first call (mirroring the server render) and then
  // silently null on every call after, because it consulted
  // round_markers on the "else" branch instead of never reaching it at
  // all for a shared-device pair. Simulating three consecutive polls —
  // every one must return the identical result.
  const first = resolveMarkedPlayerId(params)
  const second = resolveMarkedPlayerId(params)
  const third = resolveMarkedPlayerId(params)
  assert.equal(first.markedPlayerId, 'test')
  assert.equal(second.markedPlayerId, 'test')
  assert.equal(third.markedPlayerId, 'test')
})

test('resolveMarkedPlayerId — normal Digital \u2194 Digital marker resolution still works, unaffected by shared-device logic existing', () => {
  const detection = detectSharedDeviceGroup([
    { playerId: 'darren', scoringMethod: 'digital' },
    { playerId: 'razzle', scoringMethod: 'digital' },
  ])
  assert.equal(detection.isSharedDevice, false)
  const result = resolveMarkedPlayerId({
    myUserId: 'darren',
    sharedDeviceDetection: detection,
    usesMarkers: true,
    markerRows: [{ playerId: 'razzle', markerPlayerId: 'darren' }],
  })
  assert.equal(result.markedPlayerId, 'razzle')
  assert.equal(result.isSharedDevice, false)
})

test('resolveMarkedPlayerId — a shared-device relationship is never replaced by an unrelated round_markers row', () => {
  // Guards against exactly the "normal marker refetch erases the Paper
  // relationship" failure mode the brief explicitly named — even if
  // round_markers somehow contains an unrelated row naming this player,
  // shared-device detection must still take priority and the marker
  // row must be ignored, not merged or preferred.
  const detection = detectSharedDeviceGroup([
    { playerId: 'alex', scoringMethod: 'digital' },
    { playerId: 'test', scoringMethod: 'paper' },
  ])
  const result = resolveMarkedPlayerId({
    myUserId: 'alex',
    sharedDeviceDetection: detection,
    usesMarkers: true,
    markerRows: [{ playerId: 'someone-else', markerPlayerId: 'alex' }],
  })
  assert.equal(result.markedPlayerId, 'test')
  assert.equal(result.isSharedDevice, true)
})

test('resolveMarkedPlayerId — unrelated players cannot become shared-device partners', () => {
  // A marker row exists naming a completely different pair — must have
  // zero effect on Alex's own resolution when Alex isn't part of it.
  const detection: ReturnType<typeof detectSharedDeviceGroup> = { isSharedDevice: false, digitalPlayerId: null, paperPlayerId: null }
  const result = resolveMarkedPlayerId({
    myUserId: 'alex',
    sharedDeviceDetection: detection,
    usesMarkers: true,
    markerRows: [{ playerId: 'someone', markerPlayerId: 'someone-else' }],
  })
  assert.equal(result.markedPlayerId, null)
  assert.equal(result.markedByPlayerId, null)
})

test('resolveMarkedPlayerId — individual mode (usesMarkers false) still resolves a shared-device pairing', () => {
  const detection = detectSharedDeviceGroup([
    { playerId: 'alex', scoringMethod: 'digital' },
    { playerId: 'test', scoringMethod: 'paper' },
  ])
  const result = resolveMarkedPlayerId({
    myUserId: 'alex',
    sharedDeviceDetection: detection,
    usesMarkers: false,
    markerRows: [],
  })
  assert.equal(result.markedPlayerId, 'test')
})

test('resolveMarkedPlayerId — individual mode with no shared-device pairing resolves nothing (no round_markers fallback)', () => {
  const detection: ReturnType<typeof detectSharedDeviceGroup> = { isSharedDevice: false, digitalPlayerId: null, paperPlayerId: null }
  const result = resolveMarkedPlayerId({
    myUserId: 'alex',
    sharedDeviceDetection: detection,
    usesMarkers: false,
    markerRows: [{ playerId: 'test', markerPlayerId: 'alex' }], // present but irrelevant — individual mode never consults it
  })
  assert.equal(result.markedPlayerId, null)
})

test('resolveMarkedPlayerId — the paper half of a shared-device pair has no marker relationship of their own', () => {
  const detection = detectSharedDeviceGroup([
    { playerId: 'alex', scoringMethod: 'digital' },
    { playerId: 'test', scoringMethod: 'paper' },
  ])
  const result = resolveMarkedPlayerId({
    myUserId: 'test',
    sharedDeviceDetection: detection,
    usesMarkers: true,
    markerRows: [],
  })
  assert.equal(result.markedPlayerId, null)
  assert.equal(result.isSharedDevice, false)
})

// ── resolveSideCompVerifierCandidate — Consolidated Test + Fix brief ────────
// (1 Sep), item 1 regression hardening. See sharedDeviceScoring.ts's own
// header comment on this function for why this is a pure-TypeScript
// specification of migration 071's SQL, not a live-database test.

test('resolveSideCompVerifierCandidate — Group A Paper claimant resolves within Group A, never Group B', () => {
  // Exactly Darren's reported scenario: Group A (Digital A + Paper A),
  // Group B (Digital B + Paper B) — Paper A's claim must never resolve
  // to anyone in Group B, even though Group B's players share the same
  // round.
  const result = resolveSideCompVerifierCandidate({
    claimantId: 'paperA',
    claimantMarkerPlayerId: null, // Paper players never have a round_markers row
    organiserId: 'digitalA', // Group A's own digital player happens to be the organiser
    claimantGroupMembers: [
      { playerId: 'digitalA', scoringMethod: 'digital' },
      { playerId: 'paperA', scoringMethod: 'paper' },
    ],
  })
  assert.equal(result.verifierId, 'digitalA')
  assert.notEqual(result.verifierId, 'digitalB')
  assert.notEqual(result.verifierId, 'paperB')
})

test('resolveSideCompVerifierCandidate — shared-device partner takes priority over the organiser fallback when the organiser is a different person entirely', () => {
  const result = resolveSideCompVerifierCandidate({
    claimantId: 'paperA',
    claimantMarkerPlayerId: null,
    organiserId: 'someOrganiserNotInGroupA', // a genuinely different person, not Digital A
    claimantGroupMembers: [
      { playerId: 'digitalA', scoringMethod: 'digital' },
      { playerId: 'paperA', scoringMethod: 'paper' },
    ],
  })
  assert.equal(result.verifierId, 'digitalA')
  assert.equal(result.verifierSource, 'shared_device_partner')
})

test('resolveSideCompVerifierCandidate — reverse direction: Digital A claimant resolves to Paper A, the shared-device partner', () => {
  const result = resolveSideCompVerifierCandidate({
    claimantId: 'digitalA',
    claimantMarkerPlayerId: null,
    organiserId: null,
    claimantGroupMembers: [
      { playerId: 'digitalA', scoringMethod: 'digital' },
      { playerId: 'paperA', scoringMethod: 'paper' },
    ],
  })
  assert.equal(result.verifierId, 'paperA')
  assert.equal(result.verifierSource, 'shared_device_partner')
})

test('resolveSideCompVerifierCandidate — a genuine round_markers relationship still takes priority over shared-device detection', () => {
  // Not expected to co-occur in practice (a real marker relationship
  // and a shared-device pairing for the same claimant), but Tier 1 must
  // never be silently skipped if it exists.
  const result = resolveSideCompVerifierCandidate({
    claimantId: 'digitalA',
    claimantMarkerPlayerId: 'someMarker',
    organiserId: null,
    claimantGroupMembers: [
      { playerId: 'digitalA', scoringMethod: 'digital' },
      { playerId: 'paperA', scoringMethod: 'paper' },
    ],
  })
  assert.equal(result.verifierId, 'someMarker')
  assert.equal(result.verifierSource, 'marker')
})

test('resolveSideCompVerifierCandidate — final fallback is scoped to the claimant\u2019s own group, never a different one', () => {
  // A 3-player group (no shared-device pairing possible), no organiser,
  // no marker — must resolve to a groupmate, and the function is never
  // given any other group\u2019s roster to search in the first place, which
  // is itself the structural fix (the caller must not pass the whole
  // round\u2019s roster here).
  const result = resolveSideCompVerifierCandidate({
    claimantId: 'p1',
    claimantMarkerPlayerId: null,
    organiserId: null,
    claimantGroupMembers: [
      { playerId: 'p1', scoringMethod: 'digital' },
      { playerId: 'p2', scoringMethod: 'digital' },
      { playerId: 'p3', scoringMethod: 'digital' },
    ],
  })
  assert.ok(['p2', 'p3'].includes(result.verifierId))
  assert.equal(result.verifierSource, 'organiser_fallback')
})

test('resolveSideCompVerifierCandidate — Round 2 must not resolve using Round 1 relationships (caller-scoping contract)', () => {
  // This function has no concept of "round" at all — every input is
  // already scoped to one specific round\u2019s data by the caller. This
  // test documents that contract explicitly: passing Round 2\u2019s actual
  // group membership (even if it happens to differ from Round 1\u2019s, e.g.
  // after a player was reassigned) produces a result based only on what
  // was passed in, never anything persisted from a prior call.
  const round1Result = resolveSideCompVerifierCandidate({
    claimantId: 'paperA',
    claimantMarkerPlayerId: null,
    organiserId: null,
    claimantGroupMembers: [
      { playerId: 'digitalA', scoringMethod: 'digital' },
      { playerId: 'paperA', scoringMethod: 'paper' },
    ],
  })
  const round2Result = resolveSideCompVerifierCandidate({
    claimantId: 'paperA',
    claimantMarkerPlayerId: null,
    organiserId: null,
    // Reassigned to a different group for Round 2.
    claimantGroupMembers: [
      { playerId: 'digitalC', scoringMethod: 'digital' },
      { playerId: 'paperA', scoringMethod: 'paper' },
    ],
  })
  assert.equal(round1Result.verifierId, 'digitalA')
  assert.equal(round2Result.verifierId, 'digitalC')
})

test('resolveSideCompVerifierCandidate — genuinely nobody else resolves to self, explicitly flagged, never silent', () => {
  const result = resolveSideCompVerifierCandidate({
    claimantId: 'solo',
    claimantMarkerPlayerId: null,
    organiserId: null,
    claimantGroupMembers: [{ playerId: 'solo', scoringMethod: 'digital' }],
  })
  assert.equal(result.verifierId, 'solo')
  assert.equal(result.verifierSource, 'self_verified_fallback')
})
