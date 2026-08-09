export interface RoundPlayerResult {
  playerId: string
  playerName: string
  roundPoints: number
}

export interface CumulativeStanding {
  playerId: string
  playerName: string
  totalPoints: number
  position: number
  roundsPlayed: number
}

/**
 * Computes cumulative standings across any number of completed rounds.
 * Each element of `roundsResults` is one round's per-player results —
 * the caller supplies these from existing completed-round scorecard
 * data (see the accompanying report for exactly which existing tables
 * this reads from); this function itself only sums and ranks, it does
 * not know how points were derived.
 *
 * A player who appears in some but not all rounds (e.g. joined the trip
 * partway through, or a round-1-only guest) still gets a correct total
 * — their points are summed only across the rounds they actually
 * appear in, and roundsPlayed reflects that count.
 *
 * Ties share the same position (standard "1, 2, 2, 4" ranking, not
 * "1, 2, 2, 3") — two players level on points are both genuinely tied
 * for that place, not arbitrarily ordered by insertion order.
 */
export function computeCumulativeStandings(roundsResults: RoundPlayerResult[][]): CumulativeStanding[] {
  const totals = new Map<string, { playerName: string; totalPoints: number; roundsPlayed: number }>()

  for (const round of roundsResults) {
    for (const r of round) {
      const existing = totals.get(r.playerId)
      if (existing) {
        existing.totalPoints += r.roundPoints
        existing.roundsPlayed += 1
      } else {
        totals.set(r.playerId, { playerName: r.playerName, totalPoints: r.roundPoints, roundsPlayed: 1 })
      }
    }
  }

  const sorted = [...totals.entries()]
    .map(([playerId, v]) => ({ playerId, ...v }))
    .sort((a, b) => b.totalPoints - a.totalPoints)

  const result: CumulativeStanding[] = []
  let position = 0
  let previousPoints: number | null = null
  sorted.forEach((s, idx) => {
    if (s.totalPoints !== previousPoints) {
      position = idx + 1
      previousPoints = s.totalPoints
    }
    result.push({ playerId: s.playerId, playerName: s.playerName, totalPoints: s.totalPoints, position, roundsPlayed: s.roundsPlayed })
  })
  return result
}

export interface LeadersLastAssignment {
  playerId: string
  groupIndex: number // 0 = earliest tee time, highest index = latest (leaders)
}

/**
 * "Leaders Last" reverse-grid seeding: the current event leader plays in
 * the final (latest tee time) group, the lowest-ranked player plays in
 * the first (earliest) group.
 *
 * `standings` must be ordered best-to-worst (position 1 first) — the
 * same order computeCumulativeStandings already returns. `groupSize` is
 * the target size per group (existing trip/round configuration); the
 * final group absorbs any remainder if the player count doesn't divide
 * evenly, since a smaller final group is the more natural outcome for a
 * tee sheet than an uneven earlier one.
 *
 * Verified directly against the brief's own worked example: 8 players
 * in groups of 4 produces earliest group = the bottom 4 (ranks 5-8),
 * latest group = the top 4 (ranks 1-4) — matching "Group 1: John,
 * Peter, James, Tom" / "Group 2: Steve, Mark, Darren, Alex" exactly.
 */
export function seedLeadersLast(standings: { playerId: string }[], groupSize: number): LeadersLastAssignment[] {
  if (groupSize < 1) throw new Error('groupSize must be at least 1')

  // Reverse so the worst-ranked player is first — chunking front-to-back
  // from here naturally puts the lowest-ranked players in the earliest
  // chunk (group 0) and the leader in the last chunk.
  const worstFirst = [...standings].reverse()

  const assignments: LeadersLastAssignment[] = []
  let groupIndex = 0
  for (let i = 0; i < worstFirst.length; i += groupSize) {
    const chunk = worstFirst.slice(i, i + groupSize)
    for (const player of chunk) {
      assignments.push({ playerId: player.playerId, groupIndex })
    }
    groupIndex += 1
  }
  return assignments
}
