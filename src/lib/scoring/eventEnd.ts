/**
 * End Event Early: the organiser's explicit, event-level decision. Separate
 * from cancelling a round and from declaring a champion.
 *
 *   - preview        -> what will change (nothing is written)
 *   - commit         -> any unplayed round is marked cancelled, the event is
 *                       marked completed (unlocking Final Standings, Event
 *                       Memories and the Event Presentation) and the choice
 *                       "declare an overall champion?" is stored.
 *
 * Never touches scorecards, scores, side games or published results, and never
 * invents results for a cancelled round. The champion choice defaults to NO and
 * must be sent explicitly as true to crown anyone.
 */
import { canEndEvent, describeEndImpact, normaliseCancelReason } from './roundLifecycle'
import { normaliseEndNote, normaliseEndReason } from '@/lib/trips/eventOutcome'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any
export interface EndEventResult { status: number; body: Record<string, unknown> }

const REASON_TEXT: Record<string, string> = { weather: 'Event ended early: weather / course conditions', safety: 'Event ended early: safety or emergency', other: 'Event ended early' }

export async function endEvent(admin: Admin, p: { tripId: string; userId: string; preview?: boolean; declareChampion?: unknown; reason?: unknown; note?: unknown }): Promise<EndEventResult> {
  const { tripId, userId } = p
  const [tripRes, roundsRes] = await Promise.all([
    admin.from('trips').select('id, status, is_practice').eq('id', tripId).maybeSingle(),
    admin.from('rounds').select('id, name, status').eq('trip_id', tripId),
  ])
  if (!tripRes.data) return { status: 404, body: { error: 'Event not found.' } }
  const rounds = (roundsRes.data ?? []) as { id: string; name: string; status: string }[]
  const check = canEndEvent(tripRes.data.status, tripRes.data.is_practice === true, rounds)
  if (!check.ok) return { status: 409, body: { error: check.error } }
  const impact = describeEndImpact(rounds)
  if (p.preview) return { status: 200, body: { ok: true, preview: true, impact } }

  // Pre-flight: make sure the outcome columns exist BEFORE writing anything, so a missing
  // migration 099 can never leave rounds cancelled while the event is not ended.
  const probe = await admin.from('trips').select('ended_early, champion_declared').eq('id', tripId).maybeSingle()
  if (probe.error) {
    return { status: 500, body: { error: 'Ending an event needs the latest database update (migration 099). Please ask your administrator to apply it.' } }
  }

  const reason = normaliseEndReason(p.reason)
  if (!reason) return { status: 400, body: { error: 'Please choose a reason for ending the event.' } }
  const note = normaliseEndNote(p.note)
  // Explicit and strict: only the boolean true crowns a champion. Anything else means no champion.
  const championDeclared = p.declareChampion === true

  // 1. Cancel the rounds that were never played (conditional: only still-upcoming rounds).
  const unplayed = rounds.filter(r => r.status === 'upcoming')
  for (const r of unplayed) {
    const upd = await admin.from('rounds')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: userId, cancel_reason: normaliseCancelReason(REASON_TEXT[reason]) })
      .eq('id', r.id).eq('trip_id', tripId).eq('status', 'upcoming').select('id')
    if (upd.error) {
      console.error('[end-event] cancelling unplayed round failed', { code: upd.error.code, tripId })
      return { status: 500, body: { error: 'Could not end the event. Nothing was finalised; please try again.' } }
    }
    const audit = await admin.from('round_status_events').insert({ trip_id: tripId, round_id: r.id, action: 'cancelled', from_status: 'upcoming', to_status: 'cancelled', reason: REASON_TEXT[reason], actor_id: userId })
    if (audit.error) console.error('[end-event] audit insert failed', { code: audit.error.code, tripId })
  }

  // 2. Mark the event completed with how it ended. Conditional on it not already being completed.
  const upd = await admin.from('trips')
    .update({ status: 'completed', ended_early: true, champion_declared: championDeclared, ended_early_reason: reason, ended_early_note: note, ended_early_at: new Date().toISOString(), ended_early_by: userId })
    .eq('id', tripId).neq('status', 'completed').select('id')
  if (upd.error) {
    console.error('[end-event] event update failed', { code: upd.error.code, tripId })
    const missing = upd.error.code === '42703' || /ended_early|champion_declared/.test(String(upd.error.message ?? ''))
    return { status: 500, body: { error: missing ? 'Ending an event needs the latest database update (migration 099). Please ask your administrator to apply it.' : 'Could not end the event. Please try again.' } }
  }
  if (!upd.data || upd.data.length === 0) return { status: 409, body: { error: 'The event changed while you were ending it. Please refresh.' } }

  return { status: 200, body: { ok: true, endedEarly: true, championDeclared, roundsCancelled: unplayed.length } }
}
