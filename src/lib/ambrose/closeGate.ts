// Package 4 / M2 -- may an Ambrose round be closed? The existing Close Round route counts individual scorecards, which an Ambrose round does not
// have. For a round with an Ambrose configuration the route asks THIS instead, fed with the database's own team_entry_completion() answers.
// Fail safe: no teams, a missing answer, or anything other than complete === true blocks the close. Withdrawn teams are ignored.
export interface CloseEntry { name: string; withdrawn: boolean; completion: { complete?: boolean } | null }
export interface CloseVerdict { ok: boolean; reason: string | null; incomplete: string[] }

export function ambroseCloseVerdict(entries: CloseEntry[]): CloseVerdict {
  const live = entries.filter(e => !e.withdrawn)
  if (live.length === 0) return { ok: false, reason: 'No Ambrose teams are entered in this round.', incomplete: [] }
  const incomplete = live.filter(e => e.completion?.complete !== true).map(e => e.name)
  if (incomplete.length > 0) {
    return { ok: false, incomplete,
      reason: `${incomplete.length} team${incomplete.length === 1 ? ' is' : 's are'} not complete yet (${incomplete.join(', ')}). Every hole needs a score, No Returns resolved, queries closed and drive requirements met or waived.` }
  }
  return { ok: true, reason: null, incomplete: [] }
}
