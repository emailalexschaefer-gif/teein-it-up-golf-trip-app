// CANONICAL ROUND NUMBERING (27 Oct, approved rule): a round's number is its position among ALL of the event's rounds,
// cancelled ones included, in the app's one stable order (play_date, then created_at, then id -- sortRoundsChronologically).
//
//   Round 1 completed, Round 2 cancelled, Round 3 played  ->  "Round 1", "Round 2 (Cancelled)", "Round 3"
//
// Round 3 never becomes Round 2 because Round 2 was cancelled, unplayed or left out of results. Numbering and results
// ELIGIBILITY are separate: filter for scoring/presentation AFTER numbering, never number a filtered list.
//
// Known limit (reported, not hidden): the database has no stored round number, so the number comes from that order. Editing a
// round's date so it moves past another round, or deleting a round, changes the labels of the rounds after it. Making the
// number immutable needs a stored column (a migration), which has NOT been added. Every screen goes through this file, so a
// stored number can be wired in here later in one place.

import { sortRoundsChronologically } from '@/lib/scoring/multiRound'

export interface NumberableRound { id: string; play_date: string; created_at?: string | null }

const AUTO_ROUND_NAME = /^round\s+\d+$/i

/** roundId -> canonical number (1-based) over EVERY round passed in -- pass the event's complete round list. */
export function numberRounds<T extends NumberableRound>(allRounds: T[]): Map<string, number> {
  return new Map(sortRoundsChronologically(allRounds as (T & { play_date: string; created_at?: string })[]).map((r, i) => [r.id, i + 1]))
}

/**
 * The label every screen shows. An auto-named round ("Round 2", or any stale "Round N") is shown as "Round <canonical number>";
 * a deliberate custom name ("Final Round", "Sunday Battle") is kept as the organiser wrote it.
 */
export function canonicalRoundLabel(round: { id: string; name: string }, numbering: Map<string, number>): string {
  const n = numbering.get(round.id)
  if (n === undefined) return round.name
  return AUTO_ROUND_NAME.test((round.name ?? '').trim()) || !(round.name ?? '').trim() ? `Round ${n}` : round.name
}

/** Label plus status for a cancelled round, e.g. "Round 2 — Cancelled". */
export function canonicalRoundLabelWithStatus(round: { id: string; name: string; status?: string }, numbering: Map<string, number>): string {
  const base = canonicalRoundLabel(round, numbering)
  return round.status === 'cancelled' ? `${base} — Cancelled` : base
}
