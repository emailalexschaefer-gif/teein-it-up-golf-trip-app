/**
 * Single source of truth (TS side) for "who may write which capture_role,
 * in which score_capture_mode." The Postgres function
 * score_entry_capture_allowed() (migration 023) mirrors this exactly, for
 * the same reason stableford.ts and calculate_stableford_points() are two
 * synced copies — the DB needs to enforce this independently of the API
 * process. If you change the rule here, change migration 023's function
 * too.
 *
 * Fixes a real bug found in review: an earlier version of the API route
 * checked `capture_role === 'marker'` and looked up round_markers WITHOUT
 * first checking that the round's mode actually uses markers — so
 * 'individual' mode (which should behave like plain single-capture scoring,
 * no marker concept at all) would still honour a stray marker-role write if
 * one somehow existed. This function makes that distinction explicit and
 * testable.
 */

export type ScoreCaptureMode = 'self_and_marker' | 'group_scorer' | 'individual'
export type ScoreCaptureRole = 'self' | 'marker'

export interface CaptureAllowedInput {
  mode: ScoreCaptureMode
  captureRole: ScoreCaptureRole
  /** Is the caller the scorecard's own player? */
  isOwnCard: boolean
  /** Is the caller the trip organiser? Organisers may always write, in any mode. */
  isOrganiser: boolean
  /** group_scorer mode only: is the caller in the same playing group as the scorecard's player? */
  isSamePlayingGroup?: boolean
  /** self_and_marker mode only: is the caller the assigned marker for this scorecard's player? */
  isAssignedMarker?: boolean
}

export function isCaptureAllowed(input: CaptureAllowedInput): boolean {
  const { mode, captureRole, isOwnCard, isOrganiser, isSamePlayingGroup, isAssignedMarker } = input

  if (isOrganiser) return true

  if (mode === 'group_scorer') {
    // Legacy model: only 'self'-role entries exist; anyone in the same
    // playing group may write one for any member of that group.
    return captureRole === 'self' && (isOwnCard || !!isSamePlayingGroup)
  }

  if (mode === 'individual') {
    // Genuinely single-capture: no marker concept applies at all. A
    // marker-role write is never allowed here, regardless of any stray
    // round_markers data — this mode simply doesn't use that table.
    return captureRole === 'self' && isOwnCard
  }

  // self_and_marker (the default): self is own-card only; marker is the
  // assigned marker only.
  if (captureRole === 'self') return isOwnCard
  if (captureRole === 'marker') return !!isAssignedMarker
  return false
}
