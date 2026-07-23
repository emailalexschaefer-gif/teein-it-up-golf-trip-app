import { ScoringDomainError } from './errors'

export interface MarkerAssignment {
  /** The player whose score is being marked. */
  playerId: string
  /** The player who records that player's score, in addition to their own. */
  markerPlayerId: string
}

/**
 * Sensible automatic marker assignment for MVP (point 2 of the marker
 * scoring update). Assignments are always visible and editable by the
 * organiser afterward — this just seeds a reasonable default so nobody
 * has to hand-assign markers for every round.
 *
 * Rules:
 *   - 2 players: mutual pair (A marks B, B marks A).
 *   - Even player count: split into consecutive mutual pairs, in the given
 *     order — e.g. [Alex, Darren, Marnie, Sam] → (Alex↔Darren), (Marnie↔Sam).
 *   - Odd player count: circular assignment — each player marks the next,
 *     wrapping around — e.g. [Alex, Darren, Sam] → Alex marks Darren,
 *     Darren marks Sam, Sam marks Alex.
 *
 * Returns one row per player: who marks them. Order of the input array is
 * the "playing order" used to derive pairs/circle — callers should pass
 * players in a stable, meaningful order (e.g. tee order).
 */
export function generateMarkerAssignments(playerIds: string[]): MarkerAssignment[] {
  const unique = new Set(playerIds)
  if (unique.size !== playerIds.length) {
    throw new ScoringDomainError('DUPLICATE_PLAYER_ID', 'The same player cannot appear twice in a marker group')
  }
  if (playerIds.length < 2) {
    throw new ScoringDomainError('WRONG_PLAYER_COUNT', 'Marker assignment requires at least 2 players')
  }

  const isEven = playerIds.length % 2 === 0

  if (isEven) {
    const assignments: MarkerAssignment[] = []
    for (let i = 0; i < playerIds.length; i += 2) {
      const a = playerIds[i]
      const b = playerIds[i + 1]
      assignments.push({ playerId: a, markerPlayerId: b })
      assignments.push({ playerId: b, markerPlayerId: a })
    }
    return assignments
  }

  // Odd count — circular: player[i] marks player[i+1], wrapping around, so
  // player[i+1]'s marker is player[i].
  return playerIds.map((playerId, i) => ({
    playerId: playerIds[(i + 1) % playerIds.length],
    markerPlayerId: playerId,
  })).sort((a, b) => playerIds.indexOf(a.playerId) - playerIds.indexOf(b.playerId))
}
