export interface TripReadinessInput {
  memberCount: number
  ungroupedMemberCount: number
  roundCount: number
}

export interface TripReadinessResult {
  ready: boolean
  reasons: string[]
}

/**
 * Derives whether a trip has satisfied the minimum setup needed to move
 * from INVITING PLAYERS to READY TO PLAY.
 *
 * Deliberately conservative, and intentionally does NOT attempt to
 * resolve every criterion the brief listed as "at minimum consider" —
 * specifically, tee-time completeness was left out. The brief's own
 * Round Setup changes (this same package) move tee times out of
 * round-level configuration entirely ("tee times belong to playing
 * groups and will be assigned later during group setup"), but no
 * group-level tee-time field or requirement currently exists in this
 * codebase to check against. Treating tee times as a readiness
 * requirement here would mean inventing a new criterion this pass
 * doesn't otherwise implement, which the brief explicitly asked to be
 * reported rather than guessed at. See the delivery report for the full
 * reasoning — this function covers the three criteria that had a clear,
 * existing source of truth to check against.
 *
 * The three criteria checked:
 * - at least one player has joined (memberCount > 0)
 * - every joined player is assigned to a playing group
 *   (ungroupedMemberCount === 0) — the existing group_id column already
 *   represents this; a member with no group is not ready to be scored
 *   in any playing-group workflow
 * - at least one round is configured (roundCount > 0) — there is
 *   nothing to be "ready" for otherwise
 */
export function computeTripReadiness(input: TripReadinessInput): TripReadinessResult {
  const reasons: string[] = []

  if (input.memberCount === 0) reasons.push('No players have joined yet.')
  if (input.memberCount > 0 && input.ungroupedMemberCount > 0) {
    reasons.push(`${input.ungroupedMemberCount} player${input.ungroupedMemberCount === 1 ? '' : 's'} not yet assigned to a group.`)
  }
  if (input.roundCount === 0) reasons.push('No rounds configured yet.')

  return { ready: reasons.length === 0, reasons }
}
