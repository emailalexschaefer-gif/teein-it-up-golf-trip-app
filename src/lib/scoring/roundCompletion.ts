/**
 * Offline Player Support, item 10 — the round-close completion gate,
 * extracted into a pure function so its exact behaviour (paper vs
 * digital messaging, marker-mode reconciliation) can be genuinely
 * unit-tested rather than only verified by reading the inline version
 * in close/route.ts. That route calls this function directly — this
 * is not a duplicate implementation living alongside an untested one.
 */

export interface ScorecardCompletionInput {
  scoringMethod: 'digital' | 'paper'
  selfHoleCount: number
  markerHoleCountForSelfHoles: number // how many of the self-entered holes also have a marker entry
  totalHoles: number
}

export interface CompletionCheckResult {
  blocked: boolean
  reason: string | null
}

/**
 * Checks a single scorecard against the round-close requirement.
 * Returns the FIRST blocking reason found, or blocked: false if this
 * scorecard doesn't hold up the close. isMarkerMode only matters for a
 * digital scorecard — a paper player has no marker relationship to
 * reconcile at all, regardless of the round's score_capture_mode.
 */
export function checkScorecardCompletion(sc: ScorecardCompletionInput, isMarkerMode: boolean): CompletionCheckResult {
  if (sc.scoringMethod === 'paper') {
    if (sc.selfHoleCount < sc.totalHoles) {
      return { blocked: true, reason: '✏️ Paper scorecard not yet entered.' }
    }
    return { blocked: false, reason: null }
  }
  if (sc.selfHoleCount < sc.totalHoles) {
    return { blocked: true, reason: 'Not every player has finished scoring yet.' }
  }
  if (isMarkerMode && sc.markerHoleCountForSelfHoles < sc.selfHoleCount) {
    return { blocked: true, reason: 'Some holes are still awaiting marker entries.' }
  }
  return { blocked: false, reason: null }
}

/** Checks every scorecard, returning the first blocking result found (or null if the round is genuinely ready to close). */
export function checkRoundCompletion(scorecards: ScorecardCompletionInput[], isMarkerMode: boolean): CompletionCheckResult | null {
  for (const sc of scorecards) {
    const result = checkScorecardCompletion(sc, isMarkerMode)
    if (result.blocked) return result
  }
  return null
}
