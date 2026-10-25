/**
 * Round lifecycle rules for cancelling an UNPLAYED round and for deciding
 * when an event is complete. Pure functions, no I/O, so every rule is unit
 * tested and shared by the close-round route, the cancel/reinstate routes
 * and the My HQ screens (one definition, never re-derived per screen).
 *
 * Deliberately NOT touched here: scoring, verification, Stableford, side
 * games, cumulative standings. A cancelled round simply never reaches those
 * code paths because they already read only 'completed' (and 'active')
 * rounds.
 *
 * Three different things, never conflated:
 *   - a round cancelled before it started  -> status 'cancelled' (this file)
 *   - a round started then abandoned       -> NOT supported yet
 *   - a player withdrawn / DNF             -> scorecards.status 'withdrawn'
 */

export type LifecycleStatus = 'upcoming' | 'active' | 'completed' | 'cancelled'

export const CANCEL_REASON_MAX = 200

/** Only a round that has not started can be cancelled. */
export function canCancelRound(status: string): boolean {
  return status === 'upcoming'
}

/** Only a cancelled round can be reinstated. */
export function canReinstateRound(status: string): boolean {
  return status === 'cancelled'
}

export function normaliseCancelReason(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.replace(/\s+/g, ' ').trim()
  if (trimmed.length === 0) return null
  return trimmed.slice(0, CANCEL_REASON_MAX)
}

/**
 * Nothing left to play: at least one round was actually completed and every
 * other round is completed or cancelled. An all-cancelled event is never
 * "complete" (there is nothing to present). Whether the event FINISHES by
 * itself is shouldAutoCompleteEvent; ending with cancelled rounds is the
 * organiser's explicit End Event decision.
 */
export function isEventComplete(rounds: { status: string }[]): boolean {
  if (rounds.length === 0) return false
  let completed = 0
  for (const r of rounds) {
    if (r.status === 'completed') completed++
    else if (r.status !== 'cancelled') return false
  }
  return completed > 0
}

/**
 * ONLY a normal completion finishes an event by itself: every round played and
 * closed, nothing cancelled. If any round was cancelled the organiser must end
 * the event explicitly (and decide whether to declare a champion): cancelling
 * rounds, or closing the last played round, never crowns anyone on its own.
 */
export function shouldAutoCompleteEvent(rounds: { status: string }[]): boolean {
  return isEventComplete(rounds) && !rounds.some(r => r.status === 'cancelled')
}

/** Everything left is completed or cancelled and at least one round was played: the organiser can finish the event now. */
export function noPlayableRoundsRemain(rounds: { status: string }[]): boolean {
  return isEventComplete(rounds)
}

export type EndEventCheck = { ok: true } | { ok: false; error: string }

/** Can the organiser end this event now? (Trip must not already be completed, no round may be live.) */
export function canEndEvent(tripStatus: string, isPractice: boolean, rounds: { status: string }[]): EndEventCheck {
  if (isPractice) return { ok: false, error: 'Practice rounds cannot be ended this way.' }
  if (tripStatus === 'completed') return { ok: false, error: 'This event has already ended.' }
  if (rounds.some(r => r.status === 'active')) return { ok: false, error: 'A round is still being played. Close it first, then end the event.' }
  if (!rounds.some(r => r.status === 'completed')) return { ok: false, error: 'Complete at least one round before ending the event, so there is something to present.' }
  return { ok: true }
}

export interface EndImpact {
  completedRounds: number
  /** Rounds not yet played that will be marked cancelled when the event ends. */
  roundsToCancel: number
  noPlayableRoundsRemain: boolean
}

export function describeEndImpact(rounds: { status: string }[]): EndImpact {
  return {
    completedRounds: rounds.filter(r => r.status === 'completed').length,
    roundsToCancel: rounds.filter(r => r.status === 'upcoming').length,
    noPlayableRoundsRemain: noPlayableRoundsRemain(rounds),
  }
}

/** Rounds that count toward counts, progress and statistics (everything except cancelled). */
export function countedRounds<T extends { status: string }>(rounds: T[]): T[] {
  return rounds.filter(r => r.status !== 'cancelled')
}

export interface CancelImpact {
  /** Rounds that will still count once this one is cancelled. */
  remainingRounds: number
  completedRounds: number
  /** True when, after this cancellation, nothing is left to play: the organiser should now finish the event (cancelling never ends it or crowns anyone by itself). */
  noPlayableRoundsRemain: boolean
  /** True when no completed round exists yet, so the event will simply continue / has nothing to present. */
  noCompletedRounds: boolean
}

export function describeCancelImpact(rounds: { id: string; status: string }[], roundId: string): CancelImpact {
  const after = rounds.map(r => (r.id === roundId ? { ...r, status: 'cancelled' } : r))
  const counted = countedRounds(after)
  const completed = counted.filter(r => r.status === 'completed').length
  return {
    remainingRounds: counted.length,
    completedRounds: completed,
    noPlayableRoundsRemain: noPlayableRoundsRemain(after),
    noCompletedRounds: completed === 0,
  }
}
