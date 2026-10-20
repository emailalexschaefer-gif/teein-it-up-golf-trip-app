/**
 * 18 Oct field test -- where the scoring screen reopens ("Scorecard" from the
 * bottom nav, a refresh, coming back to the round).
 *
 * Rule: reopen at the LAST hole that has a score, in the order the player is
 * actually playing. If that hole is complete (own score, plus the playing
 * partner's score where one is required) the player is taken straight on to
 * the next hole that still needs a score -- Previous Hole is one tap back to
 * review the scored one. If it is not complete (e.g. own score in, partner's
 * missing) it stays on that hole so it can be finished. With no score yet the
 * caller keeps its own default (Hole 1 / the group's starting hole / a
 * ?hole= deep link) -- this function does NOT choose one, so it can never
 * override those.
 *
 * Pure. `isDone`/`isPartnerDone` must already include valid pending offline
 * entries (the caller overlays the local queue before asking).
 *
 * Set `advanceAfterComplete: false` to reopen ON the last scored hole
 * instead of the next one.
 */
export interface ResumeInput {
  /** hole numbers in the order of the screen's `holes` array */
  holeNumbers: number[]
  /** index in `holeNumbers` where play begins (0 unless a shotgun/other start rotates it) */
  startIndex?: number
  /** the player's own score exists for this hole */
  ownDone: (holeNumber: number) => boolean
  /** a playing partner's score is required on this screen (marker mode with a partner chosen) */
  partnerRequired: boolean
  /** the partner's score exists for this hole (only consulted when partnerRequired) */
  partnerDone: (holeNumber: number) => boolean
  advanceAfterComplete?: boolean
}

export interface ResumeResult {
  /** false -> nothing scored yet; caller keeps its default position */
  anyScored: boolean
  /** index into `holeNumbers`; only meaningful when anyScored */
  index: number
  /** every hole complete */
  allDone: boolean
}

export function computeResumeIndex(i: ResumeInput): ResumeResult {
  const n = i.holeNumbers.length
  if (n === 0) return { anyScored: false, index: 0, allDone: false }
  const start = ((i.startIndex ?? 0) % n + n) % n
  const at = (pos: number) => (start + pos) % n // play-order position -> index in holeNumbers
  const num = (pos: number) => i.holeNumbers[at(pos)]
  const hasScore = (pos: number) => i.ownDone(num(pos)) || (i.partnerRequired && i.partnerDone(num(pos)))
  const complete = (pos: number) => i.ownDone(num(pos)) && (!i.partnerRequired || i.partnerDone(num(pos)))

  let last = -1
  for (let pos = 0; pos < n; pos++) if (hasScore(pos)) last = pos
  if (last < 0) return { anyScored: false, index: at(0), allDone: false }

  let allDone = true
  for (let pos = 0; pos < n; pos++) if (!complete(pos)) { allDone = false; break }
  if (allDone) return { anyScored: true, index: at(n - 1), allDone: true }

  // Last scored hole still needs something (e.g. partner's score): stay on it.
  if (!complete(last) || i.advanceAfterComplete === false) return { anyScored: true, index: at(last), allDone: false }

  // Last scored hole is complete: on to the next hole that still needs a score
  // (later holes first; then any earlier gap, so nothing is left unreachable).
  for (let pos = last + 1; pos < n; pos++) if (!complete(pos)) return { anyScored: true, index: at(pos), allDone: false }
  for (let pos = 0; pos < last; pos++) if (!complete(pos)) return { anyScored: true, index: at(pos), allDone: false }
  return { anyScored: true, index: at(last), allDone: false }
}
