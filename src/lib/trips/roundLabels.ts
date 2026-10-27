import { numberRounds, canonicalRoundLabel } from './roundNumbering'

/**
 * Loads the event's COMPLETE round list (every status) and returns the canonical numbering plus a labeller, for server code
 * that only has one round in hand (a scoring page, the banner, an API answering for one round). Display only: no record changes.
 * On any failure the labeller returns the stored name unchanged, so a lookup problem can never blank a screen.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadTripRoundLabels(db: any, tripId: string): Promise<{ numbering: Map<string, number>; label: (r: { id: string; name: string }) => string }> {
  try {
    const res = await db.from('rounds').select('id, name, play_date, created_at').eq('trip_id', tripId)
    const rows = (res?.data ?? []) as { id: string; name: string; play_date: string; created_at: string }[]
    const numbering = numberRounds(rows)
    return { numbering, label: r => canonicalRoundLabel(r, numbering) }
  } catch {
    return { numbering: new Map(), label: r => r.name }
  }
}
