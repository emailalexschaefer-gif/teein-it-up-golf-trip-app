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
