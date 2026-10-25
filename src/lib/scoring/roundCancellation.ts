/**
 * Core of the cancel / reinstate round routes, with the Supabase admin client
 * injected so the whole behaviour is unit tested against an in-memory store.
 * The routes only do authentication + organiser check, then call these.
 *
 * Writes only: rounds.status/cancelled_*, round_status_events, trips.status.
 * Never touches scorecards, score_entries, side games or published results.
 */
import { canCancelRound, canReinstateRound, describeCancelImpact, noPlayableRoundsRemain, normaliseCancelReason } from './roundLifecycle'
import { readEventOutcome } from '@/lib/trips/eventOutcome'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any
export interface LifecycleResult { status: number; body: Record<string, unknown> }

export async function cancelRound(admin: Admin, p: { tripId: string; roundId: string; userId: string; reason?: unknown; preview?: boolean }): Promise<LifecycleResult> {
  const { tripId, roundId, userId } = p
  const reason = normaliseCancelReason(p.reason)

  const [tripRes, roundsRes] = await Promise.all([
    admin.from('trips').select('id, status, is_practice').eq('id', tripId).maybeSingle(),
    admin.from('rounds').select('id, name, status').eq('trip_id', tripId),
  ])
  if (!tripRes.data) return { status: 404, body: { error: 'Event not found.' } }
  if (tripRes.data.is_practice === true) return { status: 409, body: { error: 'Practice rounds cannot be cancelled.' } }
  const rounds = (roundsRes.data ?? []) as { id: string; name: string; status: string }[]
  const round = rounds.find(r => r.id === roundId)
  if (!round) return { status: 404, body: { error: 'Round not found.' } }
  if (!canCancelRound(round.status)) {
    return { status: 409, body: { error: round.status === 'cancelled' ? 'This round is already cancelled.' : 'Only a round that has not started can be cancelled.' } }
  }

  const impact = describeCancelImpact(rounds, roundId)
  if (p.preview) return { status: 200, body: { ok: true, preview: true, roundName: round.name, impact } }

  // Conditional update: only flips a round that is STILL upcoming.
  const upd = await admin.from('rounds')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: userId, cancel_reason: reason })
    .eq('id', roundId).eq('trip_id', tripId).eq('status', 'upcoming')
    .select('id')
  if (upd.error) {
    console.error('[cancel-round] update failed', { code: upd.error.code, tripId, roundId })
    return { status: 500, body: { error: 'Could not cancel the round.' } }
  }
  if (!upd.data || upd.data.length === 0) {
    return { status: 409, body: { error: 'The round changed while you were cancelling it. Please refresh.' } }
  }

  const audit = await admin.from('round_status_events').insert({
    trip_id: tripId, round_id: roundId, action: 'cancelled', from_status: 'upcoming', to_status: 'cancelled', reason, actor_id: userId,
  })
  if (audit.error) console.error('[cancel-round] audit insert failed', { code: audit.error.code, tripId, roundId })

  // Cancelling a round NEVER finishes the event or crowns anyone: the organiser
  // decides that explicitly with End Event (a separate decision, see eventEnd.ts).
  const after = rounds.map(r => (r.id === roundId ? { ...r, status: 'cancelled' } : r))
  return { status: 200, body: { ok: true, eventCompleted: false, noPlayableRoundsRemain: noPlayableRoundsRemain(after), impact } }
}

export async function reinstateRound(admin: Admin, p: { tripId: string; roundId: string; userId: string }): Promise<LifecycleResult> {
  const { tripId, roundId, userId } = p
  const [tripRes, roundRes] = await Promise.all([
    admin.from('trips').select('id, status').eq('id', tripId).maybeSingle(),
    admin.from('rounds').select('id, status').eq('id', roundId).eq('trip_id', tripId).maybeSingle(),
  ])
  if (!tripRes.data) return { status: 404, body: { error: 'Event not found.' } }
  if (!roundRes.data) return { status: 404, body: { error: 'Round not found.' } }
  if (!canReinstateRound(roundRes.data.status)) return { status: 409, body: { error: 'Only a cancelled round can be reinstated.' } }

  const upd = await admin.from('rounds')
    .update({ status: 'upcoming', cancelled_at: null, cancelled_by: null, cancel_reason: null })
    .eq('id', roundId).eq('trip_id', tripId).eq('status', 'cancelled')
    .select('id')
  if (upd.error) {
    console.error('[reinstate-round] update failed', { code: upd.error.code, tripId, roundId })
    return { status: 500, body: { error: 'Could not reinstate the round.' } }
  }
  if (!upd.data || upd.data.length === 0) {
    return { status: 409, body: { error: 'The round changed while you were reinstating it. Please refresh.' } }
  }

  const audit = await admin.from('round_status_events').insert({
    trip_id: tripId, round_id: roundId, action: 'reinstated', from_status: 'cancelled', to_status: 'upcoming', reason: null, actor_id: userId,
  })
  if (audit.error) console.error('[reinstate-round] audit insert failed', { code: audit.error.code, tripId, roundId })

  let eventReopened = false
  if (tripRes.data.status === 'completed') {
    // Reopening clears how the event ended, so it can be ended again properly later.
    // (Only written when it was ended early, so this also works before migration 099.)
    const outcome = await readEventOutcome(admin, tripId)
    const reopen = outcome.endedEarly
      ? { status: 'live', ended_early: false, champion_declared: true, ended_early_reason: null, ended_early_note: null, ended_early_at: null, ended_early_by: null }
      : { status: 'live' }
    const tripUpd = await admin.from('trips').update(reopen).eq('id', tripId)
    if (tripUpd.error) console.error('[reinstate-round] event reopen failed', { code: tripUpd.error.code, tripId })
    else eventReopened = true
  }
  const pub = await admin.from('shared_presentations').select('id').eq('trip_id', tripId).eq('status', 'active').maybeSingle()
  return { status: 200, body: { ok: true, eventReopened, presentationPublished: !!pub.data } }
}
