import { computeCumulativeStandings, type RoundPlayerResult } from '@/lib/scoring/multiRound'

/**
 * 18 Oct field test -- "Total Scores after Round N" for the presentation.
 *
 * Pure. Reuses computeCumulativeStandings (the same authoritative function
 * the Final Leaderboard uses) over the COMPLETED rounds up to and including
 * each completed round, in play order. A round that is not completed is never
 * included and never gets a slide (no mid-round snapshots). Round 1 gets
 * roundsIncluded = 1 and the builder shows no cumulative slide for it.
 *
 * The per-round results here carry no hole-by-hole points, so a tie on total
 * points is shown as a tie (same position) rather than being split by
 * countback; the final event leaderboard remains the authority on
 * countback-resolved positions.
 */
export interface CumulativeThroughRound {
  roundsIncluded: number
  standings: { playerId: string; playerName: string; totalPoints: number; position: number }[]
}

export function cumulativeThroughRounds(
  roundsInPlayOrder: { id: string; status: string }[],
  resultsByRoundId: Map<string, RoundPlayerResult[]>,
  limit = 5,
): Map<string, CumulativeThroughRound> {
  const out = new Map<string, CumulativeThroughRound>()
  const soFar: RoundPlayerResult[][] = []
  for (const r of roundsInPlayOrder) {
    if (r.status !== 'completed') continue
    soFar.push(resultsByRoundId.get(r.id) ?? [])
    const standings = computeCumulativeStandings(soFar)
      .filter(s => s.position <= limit)
      .map(s => ({ playerId: s.playerId, playerName: s.playerName, totalPoints: s.totalPoints, position: s.position }))
    out.set(r.id, { roundsIncluded: soFar.length, standings })
  }
  return out
}
