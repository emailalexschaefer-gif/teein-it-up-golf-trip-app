/**
 * Phase E (11 Oct) — results-integrity fix, extracted as a small, pure,
 * independently-testable function per the project's own established
 * convention for this kind of narration logic (see findMailman in
 * src/lib/highlights/makersBreakers.ts). Previously this was inline in
 * the Today's Highlights block of
 * src/app/api/trips/[tripId]/rounds/[roundId]/tournament/route.ts,
 * which made it untestable without a live Supabase round and request.
 *
 * `ranked` must already be sorted the same way that route sorts it —
 * totalPts desc, with holesPlayed desc as a DISPLAY-ORDER tiebreaker
 * only (never an official countback) — this function does not re-sort
 * or re-rank anything; it only decides how to WORD whatever ordering
 * it's handed. It is deliberately not the authoritative "who won"
 * calculation for the event (that remains determineChampions() in
 * multiRound.ts, which already correctly returns every player tied at
 * position 1) — this is round-level narration text only.
 *
 * Bug this replaces: the old code took `ranked[0]` as "the winner" and
 * `ranked[0].totalPts - ranked[1].totalPts` as "the margin," with no
 * check for a genuine tie at the top. When two or more players were
 * tied on points, that margin was silently 0, producing "<name> wins
 * by 0 Stableford points" — a false victory announcement for what was
 * actually a tie. This mirrors the identical fix already applied once
 * in this codebase for the same bug class (findMailman, 14 Sep: "a
 * margin of 0 is not a meaningful winning gap"), and reuses the same
 * multi-name join convention already used for a tied event champion
 * (src/lib/trips/eventSummaryText.ts: `champions.map(c =>
 * c.playerName).join(' & ')`).
 */
export interface RankedRoundPlayer {
  name: string
  totalPts: number
}

export function describeRoundWinner(ranked: RankedRoundPlayer[]): string | null {
  if (ranked.length === 0) return null
  const winner = ranked[0]
  const runnerUp = ranked[1]
  const coLeaders = ranked.filter(p => p.totalPts === winner.totalPts)

  if (coLeaders.length > 1) {
    const names = coLeaders.map(p => p.name).join(' & ')
    return `🤝 ${names} tied at the top with ${winner.totalPts} Stableford point${winner.totalPts === 1 ? '' : 's'}`
  }
  if (runnerUp) {
    const margin = winner.totalPts - runnerUp.totalPts
    return `🏆 ${winner.name} wins by ${margin} Stableford point${margin === 1 ? '' : 's'}`
  }
  return `🏆 ${winner.name} wins`
}
