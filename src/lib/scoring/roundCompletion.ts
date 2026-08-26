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
  // Shared-Device Two-Player Fix — "two official scorecards, one
  // physical device," not "one real scorecard + one marker copy." Both
  // members of a shared-device pair get this flag set (not just the
  // paper one) — the digital player's own scorecard also has no
  // genuine marker relationship in this mode, since their notional
  // "marker" (the paper player) never writes marker entries at all.
  // Root cause of the reported P0: this flag didn't exist, so a
  // digital scorecard with isMarkerMode=true always required marker
  // entries regardless of WHY it might genuinely have none.
  isSharedDevice?: boolean
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
  // Shared-device — the digital player's own scorecard is exempt from
  // the marker check too, not just their paper partner's. This is the
  // actual P0 fix: isSharedDevice is checked BEFORE isMarkerMode, so a
  // shared-device digital scorecard is never blocked on marker entries
  // that were never meant to exist for this pairing.
  if (sc.isSharedDevice) return { blocked: false, reason: null }
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
