// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

export interface RoundResultPlayer {
  playerId: string
  name: string
  totalPts: number
}

export interface RoundResult {
  roundId: string
  players: RoundResultPlayer[]
  winners: RoundResultPlayer[] // more than one entry means a tie
  isTie: boolean
}

/**
 * Computes the authoritative result for a single round from its
 * scorecards, using the exact same self-entry-only pattern already
 * established in the leaderboard route (capture_role = 'self' avoids
 * double-counting self+marker rows after migration 022). Round cards and
 * My HQ's Season Summary both call this rather than recalculating
 * independently — per the explicit "one authoritative source for round
 * winner" requirement.
 *
 * Does not filter by round.status — callers decide whether a round's
 * result should be trusted (e.g. only 'completed' rounds for cumulative
 * statistics), since a not-yet-finalised round's "result" is provisional
 * by definition and it's the caller's job to know whether that matters
 * for its own purpose.
 */
export async function getRoundResult(admin: AdminClient, roundId: string): Promise<RoundResult> {
  const scRes = await admin
    .from('scorecards')
    .select(`
      player_id, status,
      profiles:player_id ( full_name ),
      score_entries ( stableford_pts, capture_role )
    `)
    .eq('round_id', roundId)
    .neq('status', 'withdrawn')

  const players: RoundResultPlayer[] = (scRes.data ?? []).map((sc: {
    player_id: string
    profiles: { full_name: string } | null
    score_entries: { stableford_pts: number | null; capture_role: string }[]
  }) => {
    const selfEntries = (sc.score_entries ?? []).filter(e => e.capture_role === 'self')
    const totalPts = selfEntries.reduce((sum: number, e: { stableford_pts: number | null }) => sum + (e.stableford_pts ?? 0), 0)
    return { playerId: sc.player_id, name: sc.profiles?.full_name ?? 'Player', totalPts }
  })

  if (players.length === 0) {
    return { roundId, players: [], winners: [], isTie: false }
  }

  const maxPts = Math.max(...players.map(p => p.totalPts))
  const winners = players.filter(p => p.totalPts === maxPts)

  return { roundId, players, winners, isTie: winners.length > 1 }
}

export interface SeasonSummaryInput {
  roundId: string
  roundName: string
  result: RoundResult
}

export interface SeasonStanding { playerId: string; name: string; wins: number }
export interface SeasonAverage { playerId: string; name: string; average: number; roundsPlayed: number }
export interface SeasonBestRound { players: { playerId: string; name: string; pts: number; roundName: string }[]; pts: number }
export interface SeasonSummary {
  completedRoundsCount: number
  standings: SeasonStanding[]
  averages: SeasonAverage[]
  bestRound: SeasonBestRound | null
  latestResult: { roundId: string; roundName: string; winners: RoundResultPlayer[]; isTie: boolean } | null
}

/**
 * Pure aggregation over a list of already-completed rounds' results —
 * no database access, so this is directly unit-testable against the
 * exact example data in the Social Golf brief. The caller (the API
 * route) is responsible for only passing genuinely completed rounds;
 * this function trusts its input and doesn't itself filter by status.
 *
 * Each joint winner receives one full round win (not a fractional
 * share) — the brief's own recommended V1 rule. Structurally supports
 * any number of players via Map-based aggregation, not a fixed-size
 * two-player structure.
 */
export function aggregateSeasonSummary(rounds: SeasonSummaryInput[]): SeasonSummary {
  if (rounds.length === 0) {
    return { completedRoundsCount: 0, standings: [], averages: [], bestRound: null, latestResult: null }
  }

  const winsByPlayer = new Map<string, { name: string; wins: number }>()
  const totalsByPlayer = new Map<string, { name: string; sum: number; roundsPlayed: number }>()
  let bestRoundEntry: SeasonBestRound['players'] = []
  let bestPts = -Infinity

  for (const { roundName, result } of rounds) {
    for (const winner of result.winners) {
      const existing = winsByPlayer.get(winner.playerId) ?? { name: winner.name, wins: 0 }
      existing.wins += 1
      winsByPlayer.set(winner.playerId, existing)
    }

    for (const p of result.players) {
      const existing = totalsByPlayer.get(p.playerId) ?? { name: p.name, sum: 0, roundsPlayed: 0 }
      existing.sum += p.totalPts
      existing.roundsPlayed += 1
      totalsByPlayer.set(p.playerId, existing)

      if (p.totalPts > bestPts) {
        bestPts = p.totalPts
        bestRoundEntry = [{ playerId: p.playerId, name: p.name, pts: p.totalPts, roundName }]
      } else if (p.totalPts === bestPts) {
        bestRoundEntry.push({ playerId: p.playerId, name: p.name, pts: p.totalPts, roundName })
      }
    }
  }

  const standings = [...winsByPlayer.entries()]
    .map(([playerId, v]) => ({ playerId, name: v.name, wins: v.wins }))
    .sort((a, b) => b.wins - a.wins)

  // Rounding matches the project's own established convention
  // (Math.round, per resolvePlayingHandicap in defaultHoles.ts) rather
  // than truncating — applied here to 2 decimal places for an average,
  // not to a whole number, since "19.67" (not "20") is the brief's own
  // expected value.
  const averages = [...totalsByPlayer.entries()]
    .map(([playerId, v]) => ({ playerId, name: v.name, average: Math.round((v.sum / v.roundsPlayed) * 100) / 100, roundsPlayed: v.roundsPlayed }))
    .sort((a, b) => b.average - a.average)

  const last = rounds[rounds.length - 1]

  return {
    completedRoundsCount: rounds.length,
    standings,
    averages,
    bestRound: bestRoundEntry.length > 0 ? { players: bestRoundEntry, pts: bestPts } : null,
    latestResult: { roundId: last.roundId, roundName: last.roundName, winners: last.result.winners, isTie: last.result.isTie },
  }
}
