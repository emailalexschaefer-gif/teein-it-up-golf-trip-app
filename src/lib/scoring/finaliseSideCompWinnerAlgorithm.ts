/**
 * finaliseSideCompWinnerAlgorithm -- V1.13 (7 Oct). A pure, in-memory
 * mirror of migration 092's finalize_side_comp_winners() SQL, built
 * specifically so its winner-selection behaviour can be exercised
 * with constructed scenarios in this environment (no live Postgres
 * connection exists here to run the real function against). This is
 * NOT the function that runs in production -- the real SQL in
 * 092_side_comp_finalisation_algorithm_fix.sql is -- but every branch
 * here corresponds line-for-line to a CTE in that migration, and the
 * source-scanning tests in finaliseSideCompWinnerAlgorithm.test.ts
 * separately confirm the real SQL text contains the matching
 * structure, the same two-pronged approach (behavioural simulation +
 * structural confirmation of the real file) already established for
 * every other SQL-heavy fix in this project.
 */

export interface SideCompEntry {
  id: string
  playerId: string
  qualified: boolean
  verificationStatus: 'pending' | 'verified' | 'rejected'
  resultValue: number | null
}

export interface LeadChange {
  playerId: string
  sequenceNumber: number
}

export type CompType = 'longest_drive' | 'nearest_pin' | 'pros_approach' | 'powerplay' | 'best_on_day' | 'custom'

export interface FinaliseResult {
  winnerEntryId: string | null
  winnerPlayerId: string | null
}

/**
 * Mirrors the real migration's longest_drive_winner / value_based_winner
 * / winning_entry CTEs exactly: for longest_drive, the most recent
 * (highest sequenceNumber) lead change whose matching entry is
 * qualified+verified; for every other type except powerplay, the
 * qualified+verified entry with the lowest resultValue (ties broken by
 * entry id, for determinism only -- not a claimed business rule);
 * powerplay never produces a winner here, matching the live screen.
 */
export function finaliseSideCompWinner(compType: CompType, entries: SideCompEntry[], leadChanges: LeadChange[]): FinaliseResult {
  if (compType === 'longest_drive') {
    const sorted = [...leadChanges].sort((a, b) => b.sequenceNumber - a.sequenceNumber)
    for (const lc of sorted) {
      const entry = entries.find(e => e.playerId === lc.playerId)
      if (entry && entry.qualified && entry.verificationStatus === 'verified') {
        return { winnerEntryId: entry.id, winnerPlayerId: entry.playerId }
      }
    }
    return { winnerEntryId: null, winnerPlayerId: null }
  }

  if (compType === 'powerplay') {
    return { winnerEntryId: null, winnerPlayerId: null }
  }

  const qualifying = entries
    .filter(e => e.qualified && e.verificationStatus === 'verified' && e.resultValue !== null)
    .sort((a, b) => {
      const diff = (a.resultValue as number) - (b.resultValue as number)
      if (diff !== 0) return diff
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
  const best = qualifying[0]
  return best ? { winnerEntryId: best.id, winnerPlayerId: best.playerId } : { winnerEntryId: null, winnerPlayerId: null }
}
