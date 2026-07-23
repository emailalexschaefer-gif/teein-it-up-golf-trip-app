/**
 * Pure comparison logic between a player's self-entered score and their
 * marker's entry for the same hole (point 5 / point 15 of the marker
 * scoring update). No side effects, no DB access — just the state machine
 * the UI and the end-of-round reconciliation screen both read from.
 */

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
