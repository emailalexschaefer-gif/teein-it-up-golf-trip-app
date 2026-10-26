// Package 3 -- Side Game arrival reminder copy and "seen" bookkeeping (pure; no rules are invented here).
// Which games appear on a hole comes from the event's real configuration (side_comps rows for this round + hole);
// this module only words the reminder and decides whether it has already been shown.
export type ArrivalCompType = 'nearest_pin' | 'longest_drive' | 'pros_approach'
export interface ArrivalComp { id: string; comp_type: string }

const COPY: Record<ArrivalCompType, { title: string; body: string }> = {
  nearest_pin: { title: 'Nearest the Pin', body: 'Nearest the Pin is active on this hole. Remember to nominate your qualifying shot.' },
  longest_drive: { title: 'Longest Drive', body: 'Longest Drive is active on this hole. Check the rules and nominate a qualifying drive.' },
  pros_approach: { title: 'Pro’s Approach', body: 'Pro’s Approach is active on this hole. Check the competition requirements.' },
}

export function isNominatable(t: string): t is ArrivalCompType { return t === 'nearest_pin' || t === 'longest_drive' || t === 'pros_approach' }

/** Only real, enabled, nominatable games for the hole being played (Powerplay and unknown types never produce a reminder). */
export function arrivalReminders(comps: ArrivalComp[], holeNumber: number): { id: string; title: string; text: string; headline: string }[] {
  return comps.filter(c => isNominatable(c.comp_type)).map(c => {
    const copy = COPY[c.comp_type as ArrivalCompType]
    return { id: c.id, title: copy.title, text: copy.body, headline: `${copy.title} — Hole ${holeNumber}` }
  })
}

/** One key per competition INSTANCE (two instances of the same game on one hole are separate reminders). */
export function arrivalSeenKey(roundId: string, compId: string): string { return `tiu-sg-arrival-${roundId}-${compId}` }
export function sideGameAnchorId(compId: string): string { return `sidecomp-${compId}` }
