/**
 * 18 Oct field test -- which round "Scorecard" should open. Pure.
 *
 * Only an ACTIVE round is ever returned (a completed or upcoming round is
 * never "current"). If more than one round is somehow active the newest wins
 * (latest play date, then latest tee time, then the later one in the list) --
 * never an older round. Returns null when nothing is active.
 */
export interface CurrentRoundCandidate {
  id: string
  status: string
  play_date?: string | null
  tee_time?: string | null
}

export function pickCurrentRound<T extends CurrentRoundCandidate>(rounds: T[]): T | null {
  const active = rounds.map((r, i) => ({ r, i })).filter(x => x.r.status === 'active')
  if (active.length === 0) return null
  active.sort((a, b) =>
    (b.r.play_date ?? '').localeCompare(a.r.play_date ?? '') ||
    (b.r.tee_time ?? '').localeCompare(a.r.tee_time ?? '') ||
    b.i - a.i)
  return active[0].r
}
