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
import { loadEarlyFinish } from './earlyFinish'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any
export interface EndEventResult { status: number; body: Record<string, unknown> }

const REASON_TEXT: Record<string, string> = { weather: 'Event ended early: weather / course conditions', safety: 'Event ended early: safety or emergency', other: 'Event ended early' }

/**
 * Package 3: can the competition be recorded as CONCLUDED (a normal completion) although a round was finished early?
 * Every round must have been played to a result (none upcoming, none cancelled), at least one round was finished early,
 * and at least one round must count toward the championship (otherwise there is no champion to declare).
 * A concluded event is stored exactly like a normal completion (no 099 columns): it is NOT labelled "ended early".
 */
export function canConcludeCompetition(rounds: { status: string; closedEarly?: boolean; countsTowardEvent?: boolean }[]): { ok: true } | { ok: false; error: string } {
  if (rounds.some(r => r.status === 'upcoming')) return { ok: false, error: 'Some rounds have not been played. Use End Event Early instead.' }
  if (rounds.some(r => r.status === 'cancelled')) return { ok: false, error: 'A round was cancelled, so this event is recorded as ended early.' }
  if (!rounds.some(r => r.closedEarly)) return { ok: false, error: 'No round was finished early, so the event completes normally.' }
  const counted = rounds.filter(r => r.status === 'completed' && (!r.closedEarly || r.countsTowardEvent))
  if (counted.length === 0) return { ok: false, error: 'No round counts toward the championship, so there is no champion to declare. Choose \u201cEvent ended early\u201d.' }
  return { ok: true }
}

export async function endEvent(admin: Admin, p: { tripId: string; userId: string; preview?: boolean; declareChampion?: unknown; reason?: unknown; note?: unknown; outcome?: unknown }): Promise<EndEventResult> {
  const { tripId, userId } = p
  const [tripRes, roundsRes] = await Promise.all([
    admin.from('trips').select('id, status, is_practice').eq('id', tripId).maybeSingle(),
    admin.from('rounds').select('id, name, status').eq('trip_id', tripId),
  ])
  // Package 3: which rounds were finished early (tolerant: empty if migration 100 is absent).
  const earlyMap = await loadEarlyFinish(admin, ((roundsRes.data ?? []) as { id: string }[]).map(r => r.id), tripId)
  if (!tripRes.data) return { status: 404, body: { error: 'Event not found.' } }
  const rounds = (roundsRes.data ?? []) as { id: string; name: string; status: string }[]
  const check = canEndEvent(tripRes.data.status, tripRes.data.is_practice === true, rounds)
  if (!check.ok) return { status: 409, body: { error: check.error } }
  const impact = describeEndImpact(rounds)
  const conclusion = canConcludeCompetition(rounds.map(r => ({ status: r.status, closedEarly: earlyMap.has(r.id), countsTowardEvent: earlyMap.get(r.id)?.countsTowardEvent })))
  if (p.preview) return { status: 200, body: { ok: true, preview: true, impact, earlyFinishedRounds: earlyMap.size, canConclude: conclusion.ok, concludeBlockedReason: conclusion.ok ? null : conclusion.error } }

  // Package 3: "Competition concluded" -- the organiser accepts a shortened round as official and the event completes
  // exactly like a normal completion (champion decided from the standings, not labelled abandoned).
  if (p.outcome === 'concluded') {
    if (!conclusion.ok) return { status: 409, body: { error: conclusion.error } }
    const upd = await admin.from('trips').update({ status: 'completed' }).eq('id', tripId).neq('status', 'completed').select('id')
    if (upd.error) { console.error('[end-event] conclude failed', { code: upd.error.code, tripId }); return { status: 500, body: { error: 'Could not finish the event. Please try again.' } } }
    if (!upd.data || upd.data.length === 0) return { status: 409, body: { error: 'The event changed while you were finishing it. Please refresh.' } }
    return { status: 200, body: { ok: true, endedEarly: false, championDeclared: true, concluded: true, roundsCancelled: 0 } }
  }

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
