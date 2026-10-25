/**
 * My Golf → completed round results. Pure view helpers only: every number
 * shown (points, positions, handicap, per-hole gross) comes straight from
 * the existing round leaderboard route; nothing here recalculates scoring.
 */
export interface ResultsRow {
  playerId: string; name: string; handicap: number; totalPts: number
  holesPlayed: number; finished: boolean; isCurrentUser: boolean; position: number
}

/** Only a completed round has results to revisit. Cancelled rounds never do. */
export function canShowRoundResults(status: string): boolean {
  return status === 'completed'
}

export function findMyRow<T extends { isCurrentUser: boolean }>(board: T[]): T | null {
  return board.find(r => r.isCurrentUser) ?? null
}

/** Label for a player who did not hold every hole of the round (e.g. a round finished early). */
export function incompleteLabel(row: Pick<ResultsRow, 'holesPlayed' | 'finished'>, totalHoles: number): string | null {
  if (row.finished) return null
  return `Incomplete · ${row.holesPlayed}/${totalHoles} holes`
}
