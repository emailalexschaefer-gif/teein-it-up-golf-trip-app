/**
 * Default 18-hole par/stroke-index template.
 * This is a generic layout used to prefill the hole setup before a round starts.
 * It is NOT real course data. The organiser must review and edit before confirming.
 *
 * Standard allocation:
 *  - Stroke indexes alternate between front/back nine, starting with odd on front.
 *  - Pars: 2× par-5, 4× par-3, 12× par-4 on a standard par-72 course.
 */

export interface HoleTemplate {
  hole_number: number
  par: number
  stroke_index: number
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
  return Math.round(raw)
}
