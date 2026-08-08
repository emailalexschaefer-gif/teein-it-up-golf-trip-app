/**
 * Pure comparison logic between a player's self-entered score and their
 * marker's entry for the same hole (point 5 / point 15 of the marker
 * scoring update). No side effects, no DB access — just the state machine
 * the UI and the end-of-round reconciliation screen both read from.
 */

import { calculateStableford } from './stableford'

export interface CaptureValue {
  grossScore: number | null
  pickedUp: boolean
}

export type ComparisonStatus =
  | 'not_started'     // neither self nor marker has entered anything
  | 'pending_marker'  // self entered, marker hasn't yet
  | 'pending_self'    // marker entered, self hasn't yet (less common, but possible)
  | 'matched'         // both entered and they agree
  | 'mismatch'        // both entered and they disagree

/** User-facing label — kept simple per point 15, no technical language. */
export const COMPARISON_LABEL: Record<ComparisonStatus, string> = {
  not_started:    'Not started',
  pending_marker: 'Waiting for marker',
  pending_self:   'Waiting for your score',
  matched:        'Score matched',
  mismatch:       'Needs review',
}

function hasEntry(v: CaptureValue | null): v is CaptureValue {
  return v !== null && (v.pickedUp || v.grossScore !== null)
}

/**
 * Real-world case (Stage 3 field-test bug): one scorer entered a numeric
 * gross score that happened to produce 0 Stableford points, the other
 * selected Pick Up (also 0 points) — the raw entries genuinely differ, so
 * compareCaptures correctly reports 'mismatch', but from a scoring
 * standpoint nothing about the round's outcome actually disagrees.
 *
 * Deliberately a separate function, not a change to compareCaptures
 * itself: the brief is explicit that raw-entry mismatches must not be
 * silently merged (pick-up vs. a numeric score is still a different
 * record, and the organiser/players may care which one is officially
 * true), so the underlying comparison status is untouched. This lets a
 * caller that already has a 'mismatch' status additionally check whether
 * it's specifically this "both worth zero anyway" case, to show the
 * brief's recommended softer message ("Both entries score 0 points —
 * confirm score entry.") instead of the standard "Needs review" wording
 * — without ever changing what gets stored or reported as the
 * comparison result.
 *
 * Returns false (not zero-points-mismatch) for any status other than
 * 'mismatch', and for any input calculateStableford would itself reject
 * (letting the caller's own existing error handling deal with genuinely
 * invalid data rather than this function silently swallowing it).
 */
export function isZeroPointsMismatch(
  self: CaptureValue | null,
  marker: CaptureValue | null,
  context: { par: number; strokeIndex: number; selfHandicap: number; markerHandicap: number; holesInRound?: number }
): boolean {
  if (compareCaptures(self, marker) !== 'mismatch') return false
  if (!self || !marker) return false

  const pointsFor = (capture: CaptureValue, playingHandicap: number): number => {
    if (capture.pickedUp) return 0
    if (typeof capture.grossScore !== 'number') return 0
    return calculateStableford({
      grossScore: capture.grossScore, par: context.par, strokeIndex: context.strokeIndex,
      playingHandicap, holesInRound: context.holesInRound,
    })
  }

  try {
    return pointsFor(self, context.selfHandicap) === 0 && pointsFor(marker, context.markerHandicap) === 0
  } catch {
    // A genuinely invalid capture (e.g. grossScore < 1) is not this
    // function's concern to diagnose — treat it as "not this specific
    // case" and let the existing 'mismatch' status and whatever
    // validation already exists elsewhere handle it.
    return false
  }
}

/**
 * Compares a self capture against a marker capture for the same
 * scorecard+hole. A picked-up self entry compared against a numeric marker
 * entry (or vice versa) is always a mismatch (point 12) — pick-up state
 * itself is part of what's being compared, not just the score if present.
 */
export function compareCaptures(self: CaptureValue | null, marker: CaptureValue | null): ComparisonStatus {
  const selfEntered = hasEntry(self)
  const markerEntered = hasEntry(marker)

  if (!selfEntered && !markerEntered) return 'not_started'
  if (selfEntered && !markerEntered) return 'pending_marker'
  if (!selfEntered && markerEntered) return 'pending_self'

  // Both entered — compare pick-up state and gross score together.
  if (self!.pickedUp !== marker!.pickedUp) return 'mismatch'
  if (self!.pickedUp && marker!.pickedUp) return 'matched' // both picked up, no score to compare
  return self!.grossScore === marker!.grossScore ? 'matched' : 'mismatch'
}
