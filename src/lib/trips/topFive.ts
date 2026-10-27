// Top-5 presentation rule (27 Oct). Slides feature at most five RANKED rows; full standings stay in the app.
// Positions are standard competition ranking from the scoring layer (1, 2, 2, 4) and are never re-derived or tie-broken here.
//
// Tie crossing fifth place: the shown rows are always *complete* position groups. A tied group that would push the list past
// five rows is left out whole and reported in `moreTied` ("3 players tied for 4th -- see the app"), so the slide never shows an
// arbitrary subset of a tie and never claims a rank it doesn't hold. The one exception is a tie for the very top that is by
// itself larger than the limit: those are all genuine joint leaders and are all shown rather than hiding the winners.

export interface TopFive<T> { rows: T[]; moreTied: { position: number; count: number } | null }

export function limitToTopFive<T extends { position: number }>(input: T[], limit = 5): TopFive<T> {
  const rows = [...input].sort((a, b) => a.position - b.position)
  if (rows.length <= limit) return { rows, moreTied: null }
  const groups: T[][] = []
  for (const r of rows) {
    const last = groups[groups.length - 1]
    if (last && last[0].position === r.position) last.push(r); else groups.push([r])
  }
  const shown: T[] = []
  let moreTied: TopFive<T>['moreTied'] = null
  for (const g of groups) {
    if (shown.length + g.length <= limit) { shown.push(...g); continue }
    if (shown.length === 0) { shown.push(...g); continue } // joint leaders: never hide the winners
    if (g.length > 1) moreTied = { position: g[0].position, count: g.length }
    break
  }
  return { rows: shown, moreTied }
}

/** "3 players tied for 4th" -- null when nothing was left out. */
export function moreTiedText(m: { position: number; count: number } | null | undefined): string | null {
  if (!m) return null
  const s = ['th', 'st', 'nd', 'rd'][(m.position % 100 >= 11 && m.position % 100 <= 13) ? 0 : Math.min(m.position % 10, 4) % 4 === m.position % 10 ? m.position % 10 : 0] ?? 'th'
  return `${m.count} more players tied for ${m.position}${s} · full standings in the app`
}
