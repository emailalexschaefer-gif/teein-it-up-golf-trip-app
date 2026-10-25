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
 * An event is complete when at least one round was actually completed and
 * every other round is completed or cancelled. A cancelled round never
 * blocks completion; an all-cancelled event is never "complete" (there is
 * nothing to present or declare a champion from).
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

/** Rounds that count toward counts, progress and statistics (everything except cancelled). */
export function countedRounds<T extends { status: string }>(rounds: T[]): T[] {
  return rounds.filter(r => r.status !== 'cancelled')
}

export interface CancelImpact {
  /** Rounds that will still count once this one is cancelled. */
  remainingRounds: number
  completedRounds: number
  /** True when cancelling this round finishes the event (champion declared from completed rounds). */
  completesEvent: boolean
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
    completesEvent: isEventComplete(after),
    noCompletedRounds: completed === 0,
  }
}
