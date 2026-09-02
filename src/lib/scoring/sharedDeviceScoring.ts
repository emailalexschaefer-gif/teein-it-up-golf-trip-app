/**
 * Add-on 1 — Shared-Device Scoring detection.
 *
 * "Exactly 1 Digital player + exactly 1 Paper player" in a 2-player
 * group. Deliberately narrow — any other group shape (solo, 3+
 * players, 2 digital, 2 paper) must fall through to the existing,
 * already-field-tested standard workflows unchanged. This function
 * only answers the detection question; it does not decide what to
 * render or how scores get written — those are separate, not yet
 * built pieces (see this feature's own delivery report).
 */

export interface GroupMemberScoringMethod {
  playerId: string
  scoringMethod: 'digital' | 'paper'
}

export interface SharedDeviceDetectionResult {
  isSharedDevice: boolean
  digitalPlayerId: string | null
  paperPlayerId: string | null
}

export function detectSharedDeviceGroup(members: GroupMemberScoringMethod[]): SharedDeviceDetectionResult {
  const none: SharedDeviceDetectionResult = { isSharedDevice: false, digitalPlayerId: null, paperPlayerId: null }
  if (members.length !== 2) return none

  const digital = members.filter(m => m.scoringMethod === 'digital')
  const paper = members.filter(m => m.scoringMethod === 'paper')
  if (digital.length !== 1 || paper.length !== 1) return none

  return { isSharedDevice: true, digitalPlayerId: digital[0].playerId, paperPlayerId: paper[0].playerId }
}

/**
 * Live Scoring Stabilisation brief (1 Sep) — P1, "protect the paper-
 * player polling fix." The actual P0 root cause was two independent
 * implementations of "who is my marked/shared-device partner" —
 * page.tsx's (correct from the start) and /my-scores's (missing
 * shared-device awareness entirely, silently overwriting a correctly-
 * resolved partner with null on every poll). Extracted here as one
 * shared, pure, testable decision: shared-device detection ALWAYS
 * takes priority over a round_markers lookup — never the reverse, and
 * never both consulted independently by different callers. Any future
 * caller of "resolve my marked scorecard" should use this function
 * rather than reimplementing the same two-path decision a third time.
 *
 * Deliberately operates on already-fetched, plain data (no Supabase
 * client, no I/O) — exactly the same "pure decision, caller does the
 * fetching" shape as detectSharedDeviceGroup itself above.
 */
export interface MarkedScorecardCandidate {
  playerId: string
}

export interface MarkerRelationshipRow {
  playerId: string       // the player being marked
  markerPlayerId: string // the player doing the marking
}

export function resolveMarkedPlayerId(params: {
  myUserId: string
  sharedDeviceDetection: SharedDeviceDetectionResult
  usesMarkers: boolean
  markerRows: MarkerRelationshipRow[]
}): { markedPlayerId: string | null; markedByPlayerId: string | null; isSharedDevice: boolean } {
  const { myUserId, sharedDeviceDetection, usesMarkers, markerRows } = params

  // Shared-device pairing takes priority and is checked FIRST — this
  // ordering is the actual fix, not an implementation detail. A round
  // in self_and_marker mode can contain both a genuine marker
  // relationship (a different group) and a shared-device relationship
  // (this group) at once; usesMarkers being true must never cause a
  // round_markers lookup to run for a player who is the digital half
  // of a shared-device pair.
  if (sharedDeviceDetection.isSharedDevice && sharedDeviceDetection.digitalPlayerId === myUserId) {
    return { markedPlayerId: sharedDeviceDetection.paperPlayerId, markedByPlayerId: null, isSharedDevice: true }
  }

  if (!usesMarkers) {
    return { markedPlayerId: null, markedByPlayerId: null, isSharedDevice: false }
  }

  const markedByRow = markerRows.find(r => r.playerId === myUserId)
  const iMarkRow = markerRows.find(r => r.markerPlayerId === myUserId)

  return {
    markedPlayerId: iMarkRow?.playerId ?? null,
    markedByPlayerId: markedByRow?.markerPlayerId ?? null,
    isSharedDevice: false,
  }
}

/**
 * Consolidated Test + Fix brief (1 Sep) — item 1 regression hardening,
 * "Side Game multi-group verifier scoping."
 *
 * The REAL resolution runs server-side in Postgres
 * (resolve_side_comp_verifier(), migration 071) — this sandbox has no
 * live database connection, so that function's actual runtime
 * behaviour cannot be executed here. This is a pure-TypeScript
 * SPECIFICATION of the identical decision tree 071's SQL body
 * implements — same tier order, same group-scoping rule — genuinely
 * testable, and a deliberate, explicit description of the correct
 * behaviour rather than a disconnected mock: see migration 071's own
 * header for the SQL side of this exact same logic, and
 * sideCompVerifierMigration.test.ts for a structural check that the
 * deployed SQL text still contains the corresponding fallback-scoping
 * fix. Neither test can prove the live database behaves correctly on
 * its own; together they at least ensure the intended algorithm is
 * unambiguously documented and that the deployed SQL hasn't silently
 * regressed back to round-wide scoping.
 */
export interface SideCompVerifierGroupMember {
  playerId: string
  scoringMethod: 'digital' | 'paper'
}

export function resolveSideCompVerifierCandidate(params: {
  claimantId: string
  claimantMarkerPlayerId: string | null // round_markers row for the claimant, if any
  organiserId: string | null
  claimantGroupMembers: SideCompVerifierGroupMember[] // ONLY the claimant's own group — never the whole round
}): { verifierId: string; verifierSource: 'marker' | 'shared_device_partner' | 'organiser_fallback' | 'self_verified_fallback' } {
  const { claimantId, claimantMarkerPlayerId, organiserId, claimantGroupMembers } = params

  // Tier 1 — genuine marker relationship, unchanged, highest priority.
  if (claimantMarkerPlayerId) {
    return { verifierId: claimantMarkerPlayerId, verifierSource: 'marker' }
  }

  // Tier 2 — shared-device partner, scoped to the claimant's OWN group
  // only (claimantGroupMembers is never the whole round's roster) —
  // this is the actual fix. A Paper claimant always lands here or at
  // Tier 1, never falling through to a same-round-but-different-group
  // stranger.
  const detection = detectSharedDeviceGroup(claimantGroupMembers)
  if (detection.isSharedDevice) {
    const partnerId = detection.digitalPlayerId === claimantId ? detection.paperPlayerId : detection.digitalPlayerId
    if (partnerId) return { verifierId: partnerId, verifierSource: 'shared_device_partner' }
  }

  // Tier 3 — organiser, if they exist and aren't the claimant themselves.
  if (organiserId && organiserId !== claimantId) {
    return { verifierId: organiserId, verifierSource: 'organiser_fallback' }
  }

  // Tier 4 — any other member of the claimant's OWN group (never a
  // different group) — this is the second half of the fix; the old
  // behaviour searched the entire round here.
  const groupmate = claimantGroupMembers.find(m => m.playerId !== claimantId)
  if (groupmate) {
    return { verifierId: groupmate.playerId, verifierSource: 'organiser_fallback' }
  }

  // Tier 5 — genuinely nobody else.
  return { verifierId: claimantId, verifierSource: 'self_verified_fallback' }
}
