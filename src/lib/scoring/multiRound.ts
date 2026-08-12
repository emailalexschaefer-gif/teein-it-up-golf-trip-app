export interface RoundPlayerResult {
  playerId: string
  playerName: string
  roundPoints: number
}

export interface RoundOrderingInput {
  id: string
  play_date: string
  created_at: string
}

/**
 * Stable, deterministic chronological ordering for a trip's rounds.
 *
 * Root cause this exists to fix: rounds are typically created together
 * in a single multi-row INSERT at trip setup, and Postgres's now()
 * resolves to transaction-start time — not per-row — so every round
 * created in that batch gets an IDENTICAL created_at. Ordering (or
 * filtering with .lt()/.lte()) by created_at alone therefore has no
 * reliable result when two rounds tie exactly, which they do by
 * construction. This was the actual root cause of Round 1's data
 * appearing under Round 2's "LIVE" column on the multi-round
 * leaderboard: the round holding the correct live data was
 * mislabeled "roundNumber: 1" purely because of arbitrary tie-breaking
 * in an ORDER BY with no secondary key — the underlying per-round
 * totals were always correctly scoped by round_id, only the column
 * LABEL was wrong.
 *
 * play_date (the organiser's actual configured chronological order,
 * already surfaced in the UI as each round's date) is the primary sort
 * key; created_at and id are deterministic tiebreakers only for rounds
 * sharing the same play_date. Fully generic — works identically for 2,
 * 3, or 20 rounds, with no round-count-specific branching anywhere.
 */
export function sortRoundsChronologically<T extends RoundOrderingInput>(rounds: T[]): T[] {
  return [...rounds].sort((a, b) =>
    a.play_date.localeCompare(b.play_date)
    || a.created_at.localeCompare(b.created_at)
    || a.id.localeCompare(b.id)
  )
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

export interface RoundWinner { playerId: string; playerName: string; points: number }

/**
 * The winner(s) of a single round, independent of overall cumulative
 * standing — the player(s) with the highest points in that round only.
 * Tie-safe by construction: returns every player who reached the max,
 * never picks one arbitrarily by array/database order. An empty
 * `results` array (a round with no scorecards at all) returns an empty
 * winners list rather than crashing or inventing a winner.
 */
export function determineRoundWinners(results: RoundPlayerResult[]): RoundWinner[] {
  if (results.length === 0) return []
  const maxPoints = Math.max(...results.map(r => r.roundPoints))
  return results.filter(r => r.roundPoints === maxPoints)
    .map(r => ({ playerId: r.playerId, playerName: r.playerName, points: r.roundPoints }))
}

export interface Champion { playerId: string; playerName: string; totalPoints: number }

/**
 * The event champion(s) from already-computed cumulative standings —
 * whichever player(s) hold position 1. Teein' It Up has no formal
 * countback/tie-break rule today (confirmed by inspection, not assumed);
 * this deliberately does not invent one. Two players level on points at
 * the top both come back as champions, honestly, rather than the first
 * one encountered being promoted to sole champion.
 */
export function determineChampions(standings: CumulativeStanding[]): Champion[] {
  return standings.filter(s => s.position === 1)
    .map(s => ({ playerId: s.playerId, playerName: s.playerName, totalPoints: s.totalPoints }))
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
