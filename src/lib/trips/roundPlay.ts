// Presentation eligibility for a round's RESULTS (27 Oct field test -- Lappen Invitational).
// Symptom: a washed-out Round 2 produced a Results page listing every player as a joint winner on 0 points, running off the
// screen. Root cause: a round that is 'completed' (or otherwise not 'cancelled') but has scorecards with NO recorded scores
// is ranked like any other round -- 20 players on 0 all share position 1, and the "never split a tie at the cutoff" rule keeps
// all of them.
//
// "Played" is decided by whether scores were RECORDED, never by points: a legitimately played round can contain zero-point
// holes (a picked-up hole is stored as an entry with 0 points) and must still be presented. No scoring rule changes.

import type { RoundPlayerResult } from '@/lib/scoring/multiRound'

export interface ScorecardPlay {
  playerId: string
  playerName: string
  entries: { stableford_pts: number | null; capture_role: string }[]
}

export interface RoundPlay {
  /** at least one player recorded at least one score of their own */
  hasRecordedScores: boolean
  /** only players who actually recorded scores, so a no-show on 0 is never ranked or called a winner */
  results: RoundPlayerResult[]
}

export function summariseRoundPlay(scorecards: ScorecardPlay[]): RoundPlay {
  const results: RoundPlayerResult[] = []
  for (const sc of scorecards) {
    const own = (sc.entries ?? []).filter(e => e.capture_role === 'self')
    if (own.length === 0) continue
    results.push({
      playerId: sc.playerId, playerName: sc.playerName,
      roundPoints: own.reduce((sum, e) => sum + (e.stableford_pts ?? 0), 0),
      holePoints: [],
    })
  }
  return { hasRecordedScores: results.length > 0, results }
}

/** A round the presentation may show: never cancelled, and (when the manifest says so) never an unplayed one. */
export function isPresentableRound(r: { status: string; hasRecordedScores?: boolean | null }): boolean {
  if (r.status === 'cancelled') return false
  if (r.hasRecordedScores === false) return false
  return true
}
