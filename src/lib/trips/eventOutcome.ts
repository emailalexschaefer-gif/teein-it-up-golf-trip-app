/**
 * How an event ended -- kept separate from round status and from trips.status.
 *
 *   normal completion          all rounds played and closed      -> champion declared
 *   ended early, no champion   organiser ended it, chose "No"    -> final standings only
 *   ended early + champion     organiser ended it, chose "Yes"   -> champion declared
 *
 * trips.status = 'completed' is still the single terminal switch that unlocks
 * Final Standings, Event Memories and the Event Presentation. These columns only
 * say HOW it finished (migration 099). Reads are defensive: if 099 has not been
 * applied (or a column is missing) every event is treated as a normal completion,
 * which is exactly the behaviour before this change.
 */

export type EndReason = 'weather' | 'safety' | 'other'
export const END_REASONS: { value: EndReason; label: string }[] = [
  { value: 'weather', label: 'Weather / course conditions' },
  { value: 'safety', label: 'Safety or emergency' },
  { value: 'other', label: 'Other' },
]
export const END_NOTE_MAX = 200

export interface EventOutcome {
  endedEarly: boolean
  /** True for a normal completion and for "ended early, champion declared". */
  championDeclared: boolean
  reason: EndReason | null
  note: string | null
}

export const NORMAL_OUTCOME: EventOutcome = { endedEarly: false, championDeclared: true, reason: null, note: null }
export const OUTCOME_COLUMNS = 'ended_early, champion_declared, ended_early_reason, ended_early_note'

/** Accepts a database row (or anything) and returns a safe outcome; missing/invalid fields mean "normal". */
export function parseOutcome(row: unknown): EventOutcome {
  if (!row || typeof row !== 'object') return NORMAL_OUTCOME
  const r = row as Record<string, unknown>
  const endedEarly = r.ended_early === true
  // A normal completion can never be "no champion": only an ended-early event may lack one.
  const championDeclared = endedEarly ? r.champion_declared !== false : true
  const reason = r.ended_early_reason === 'weather' || r.ended_early_reason === 'safety' || r.ended_early_reason === 'other' ? r.ended_early_reason : null
  const note = typeof r.ended_early_note === 'string' && r.ended_early_note.trim() ? r.ended_early_note.trim().slice(0, END_NOTE_MAX) : null
  return { endedEarly, championDeclared, reason: endedEarly ? reason : null, note: endedEarly ? note : null }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

export async function readEventOutcome(admin: Admin, tripId: string): Promise<EventOutcome> {
  try {
    const { data, error } = await admin.from('trips').select(OUTCOME_COLUMNS).eq('id', tripId).maybeSingle()
    if (error || !data) return NORMAL_OUTCOME
    return parseOutcome(data)
  } catch { return NORMAL_OUTCOME }
}

export async function readEventOutcomes(admin: Admin, tripIds: string[]): Promise<Map<string, EventOutcome>> {
  const out = new Map<string, EventOutcome>()
  if (tripIds.length === 0) return out
  try {
    const { data, error } = await admin.from('trips').select(`id, ${OUTCOME_COLUMNS}`).in('id', tripIds)
    if (error || !data) return out
    for (const row of data as { id: string }[]) out.set(row.id, parseOutcome(row))
  } catch { /* defaults */ }
  return out
}

export function normaliseEndReason(input: unknown): EndReason | null {
  return input === 'weather' || input === 'safety' || input === 'other' ? input : null
}

export function normaliseEndNote(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const t = input.replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, END_NOTE_MAX) : null
}

/** What a completed event's presentation / results may claim. */
export function championAllowed(outcome: EventOutcome): boolean {
  return outcome.championDeclared
}
