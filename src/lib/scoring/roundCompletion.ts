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
 * scorecard doesn't hold up the close.
 *
 * Darren field-test fix (Release 1, item 1) — Playing Partner selection
 * is now deliberately directional and never automatic: a player choosing
 * to mark someone does not create any reciprocal obligation, and
 * nothing pairs players up for them anymore (see markerAssignment.ts /
 * playing-partner/route.ts). That means a player can now genuinely
 * reach the end of a round with nobody having chosen to mark them at
 * all — a normal, valid, expected outcome of a permissive model, not an
 * error condition. This function used to require
 * markerHoleCountForSelfHoles to equal selfHoleCount before a digital
 * scorecard in self_and_marker mode could complete, which would have
 * permanently blocked exactly that player's card from ever closing —
 * markerHoleCountForSelfHoles would simply stay 0 forever, since nobody
 * marking them isn't a temporary/waiting state, it's the final state.
 * isMarkerMode is kept as a parameter for compatibility with existing
 * callers, but no longer blocks completion — a scorecard's own
 * completion is now determined entirely by the player's own self
 * entries, exactly as a paper scorecard's always has been. Marker data,
 * where it happens to exist, remains available for reconciliation/
 * review — separately, informationally, never as a completion gate.
 */
export function checkScorecardCompletion(sc: ScorecardCompletionInput, _isMarkerMode: boolean): CompletionCheckResult {
  if (sc.scoringMethod === 'paper') {
    if (sc.selfHoleCount < sc.totalHoles) {
      return { blocked: true, reason: '✏️ Paper scorecard not yet entered.' }
    }
    return { blocked: false, reason: null }
  }
  if (sc.selfHoleCount < sc.totalHoles) {
    return { blocked: true, reason: 'Not every player has finished scoring yet.' }
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
