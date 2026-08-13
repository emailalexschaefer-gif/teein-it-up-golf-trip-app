/**
 * Default 18-hole par/stroke-index template.
 * This is a generic layout used to prefill the hole setup before a round starts.
 * It is NOT real course data. The organiser must review and edit before confirming.
 *
 * Standard allocation:
 *  - Stroke indexes alternate between front/back nine, starting with odd on front.
 *  - Pars: 2× par-5, 4× par-3, 12× par-4 on a standard par-72 course.
 */

import { roundHandicap } from './rounding'

export interface HoleTemplate {
  hole_number: number
  par: number
  stroke_index: number
  // Course Library v1 — optional, only ever populated when this template
  // came from a library snapshot rather than the generic default/manual
  // entry. Not required by scoring (nothing reads it for any
  // calculation), purely round-metadata preserved through to the
  // holes table for display.
  distance?: number | null
}

export const DEFAULT_18_HOLES: HoleTemplate[] = [
  { hole_number:  1, par: 4, stroke_index:  1 },
  { hole_number:  2, par: 4, stroke_index: 11 },
  { hole_number:  3, par: 3, stroke_index: 15 },
  { hole_number:  4, par: 5, stroke_index:  5 },
  { hole_number:  5, par: 4, stroke_index:  9 },
  { hole_number:  6, par: 4, stroke_index:  3 },
  { hole_number:  7, par: 3, stroke_index: 13 },
  { hole_number:  8, par: 5, stroke_index:  7 },
  { hole_number:  9, par: 4, stroke_index: 17 },
  { hole_number: 10, par: 4, stroke_index:  2 },
  { hole_number: 11, par: 4, stroke_index: 12 },
  { hole_number: 12, par: 3, stroke_index: 16 },
  { hole_number: 13, par: 5, stroke_index:  6 },
  { hole_number: 14, par: 4, stroke_index: 10 },
  { hole_number: 15, par: 4, stroke_index:  4 },
  { hole_number: 16, par: 3, stroke_index: 14 },
  { hole_number: 17, par: 5, stroke_index:  8 },
  { hole_number: 18, par: 4, stroke_index: 18 },
]

export const DEFAULT_9_HOLES: HoleTemplate[] = [
  { hole_number: 1, par: 4, stroke_index: 1 },
  { hole_number: 2, par: 4, stroke_index: 5 },
  { hole_number: 3, par: 3, stroke_index: 7 },
  { hole_number: 4, par: 5, stroke_index: 3 },
  { hole_number: 5, par: 4, stroke_index: 9 },
  { hole_number: 6, par: 4, stroke_index: 2 },
  { hole_number: 7, par: 3, stroke_index: 8 },
  { hole_number: 8, par: 5, stroke_index: 4 },
  { hole_number: 9, par: 4, stroke_index: 6 },
]

/**
 * Back Nine default template — holes 10-18, retaining their real course
 * hole numbers (not renumbered to 1-9) and their own stroke index
 * values, exactly as a real course's back nine would have. Derived
 * directly from DEFAULT_18_HOLES's own back-nine holes rather than a
 * separately invented placeholder, so the two stay consistent with each
 * other as the same underlying generic template. Same principle as the
 * existing defaults: a starting point the organiser reviews and edits,
 * not real course data.
 */
export const DEFAULT_9_BACK_HOLES: HoleTemplate[] = DEFAULT_18_HOLES.filter(h => h.hole_number > 9)

export type PlayingNine = 'front' | 'back' | 'custom'

/**
 * Playing Nine selector helper — Front/Back load their respective
 * generic templates (still fully editable); Custom starts from the
 * Front Nine template as a baseline but is expected to have every field,
 * including hole number, edited freely.
 */
export function getDefaultHolesForNine(nine: PlayingNine): HoleTemplate[] {
  if (nine === 'back') return DEFAULT_9_BACK_HOLES.map(h => ({ ...h }))
  return DEFAULT_9_HOLES.map(h => ({ ...h }))
}

export function getDefaultHoles(holeCount: 9 | 18): HoleTemplate[] {
  return holeCount === 9 ? DEFAULT_9_HOLES : DEFAULT_18_HOLES
}

/**
 * Handicap rounding rule (applied at scorecard creation).
 *
 * RULE: Math.round() — round to the nearest whole number.
 *
 * Examples:
 *   14.4 → 14
 *   14.5 → 15
 *   14.6 → 15
 *   22.5 → 23
 *
 * Rationale: Math.round() is fairer than Math.floor() because it avoids
 * consistently disadvantaging players whose decimal handicap is ≥ .5.
 * Under Math.floor(), a player with 14.9 would play off 14 — receiving
 * one fewer stroke than a 15-handicapper — despite being effectively the
 * same standard. Math.round() eliminates this bias.
 *
 * WHS guidance: The World Handicap System uses the "Course Handicap" formula
 * (Handicap Index × Slope Rating / 113 + (Course Rating − Par)), rounded to
 * the nearest whole number. Our simplified version (player playing handicap,
 * no slope applied) follows the same rounding direction.
 *
 * The resolved integer handicap is shown to the organiser in the confirmation
 * modal before the round starts, so they can override via the Players tab
 * if the rounded value is unsuitable.
 *
 * This value is locked into the scorecard at round start and does not change
 * if the player's profile handicap is updated later.
 */
export function resolvePlayingHandicap(
  tripHandicap: number | null | undefined,
  profileHandicap: number | null | undefined,
): number | null {
  const raw = tripHandicap ?? profileHandicap ?? null
  if (raw === null) return null
  return roundHandicap(raw)
}

// ── Course Library v1 ───────────────────────────────────────────────────────

export interface LibraryHoleSnapshot {
  hole_number: number
  par: number
  stroke_index: number | null
  distance: number | null
}

/**
 * Derives the hole-review-screen starting state for BeginRoundModal.
 * Extracted as a pure function specifically so this is unit-testable
 * without a browser — it was previously an inline useState initializer.
 *
 * Frozen library snapshot data takes priority over the generic default
 * template whenever one exists — never a fresh read from the library
 * tables themselves (this function has no access to them at all; it
 * only ever sees whatever snapshot was already passed in, which is the
 * whole point: a later library edit cannot retroactively change what
 * this function returns for an already-configured round, because the
 * snapshot argument itself was frozen at round-setup time, not read
 * live here).
 *
 * A missing stroke_index (a library course with genuinely unverified SI
 * data) defaults to the hole's own number — always a valid, unique 1-18
 * value satisfying the holes table's own UNIQUE(round_id, stroke_index)
 * constraint, and something the organiser can still see and correct
 * before confirming. This is a safe placeholder for round-level working
 * data, never presented anywhere as verified library fact.
 *
 * A snapshot with zero entries, or none at all (a manually-configured
 * round, or any round created before Course Library existed), falls
 * back to the exact same getDefaultHoles(holeCount) behaviour this
 * function replaces — byte-identical to pre-Course-Library output.
 */
export function deriveBeginRoundHoles(
  libraryHolesSnapshot: LibraryHoleSnapshot[] | null | undefined,
  holeCount: 9 | 18,
): HoleTemplate[] {
  if (libraryHolesSnapshot && libraryHolesSnapshot.length > 0) {
    return libraryHolesSnapshot
      .filter(h => h.hole_number <= holeCount)
      .sort((a, b) => a.hole_number - b.hole_number)
      .map(h => ({ hole_number: h.hole_number, par: h.par, stroke_index: h.stroke_index ?? h.hole_number, distance: h.distance }))
  }
  return getDefaultHoles(holeCount)
}

/**
 * Front/Back Nine selection for a round already using a library
 * snapshot — the fix for a real defect found during this build's own
 * review: BeginRoundModal's nine-selector previously called
 * getDefaultHolesForNine() unconditionally, silently discarding real
 * course data (par/stroke index/distance) the moment an organiser chose
 * Front/Back/Custom on a 9-hole round sourced from an 18-hole library
 * course, and replacing it with the same generic placeholder template
 * used for a completely manual round.
 *
 * Slices the ORIGINAL, full library snapshot (never the already-sliced
 * `holes` component state, and never re-fetched from anywhere — the
 * snapshot argument here is the same frozen array threaded all the way
 * through from round setup) to holes 1-9 (front) or 10-18 (back),
 * preserving every field — hole_number, par, stroke_index, distance —
 * exactly as stored. Does not mutate the snapshot passed in: filter/
 * sort/map all return new arrays, the input is only ever read.
 *
 * Falls back to the generic getDefaultHolesForNine() template only when
 * there is genuinely no snapshot, or the snapshot has zero holes in the
 * requested range (e.g. a 9-hole-only library entry and Back Nine was
 * requested) — never a silent switch away from real data that does
 * exist, exactly the same "generic template is the fallback, not the
 * default, when real data exists" principle deriveBeginRoundHoles above
 * already established for the initial 18-hole load.
 *
 * Custom nine needs no equivalent function: BeginRoundModal's existing
 * Custom handling already leaves `holes` state untouched rather than
 * resetting it, so once Front/Back correctly seed real snapshot data,
 * switching to Custom from either one inherits that real data as its
 * starting point for free.
 */
export function deriveNineHoles(
  libraryHolesSnapshot: LibraryHoleSnapshot[] | null | undefined,
  nine: 'front' | 'back',
): HoleTemplate[] {
  if (libraryHolesSnapshot && libraryHolesSnapshot.length > 0) {
    const [lo, hi] = nine === 'front' ? [1, 9] : [10, 18]
    const sliced = libraryHolesSnapshot
      .filter(h => h.hole_number >= lo && h.hole_number <= hi)
      .sort((a, b) => a.hole_number - b.hole_number)
      .map(h => ({ hole_number: h.hole_number, par: h.par, stroke_index: h.stroke_index ?? h.hole_number, distance: h.distance }))
    if (sliced.length > 0) return sliced
  }
  return getDefaultHolesForNine(nine)
}

