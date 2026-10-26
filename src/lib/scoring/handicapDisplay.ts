// Handicap DISPLAY helpers. Display only -- never used by scoring.
//
// Representation used everywhere in the system (database, API, scoring engine): ONE signed number.
//   +4 handicap (plus 4)  -> -4      scratch -> 0      18 handicap -> 18
// A plus handicap is stored as a NEGATIVE number because that is what the stroke allocation (and the database's
// calculate_stableford_points) expect: a plus-handicap golfer gives strokes back on the easiest holes.
// Players expect golf notation on screen, so negatives are SHOWN with a plus sign. The stored value never changes.
export function formatGolfHandicap(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '\u2014'
  const abs = Math.abs(value)
  const text = abs % 1 === 0 ? abs.toFixed(0) : abs.toFixed(1)
  return value < 0 ? `+${text}` : text
}

/** For organiser steppers that change the underlying number: "HCP +2 (stored -2)" avoids any doubt. */
export function formatGolfHandicapWithStored(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '\u2014'
  return value < 0 ? `+${Math.abs(value)} (stored ${value})` : formatGolfHandicap(value)
}

/** Supported Handicap Index / event handicap entry range -- the existing rule (trip_members CHECK, join prompt).
 *  Negative = plus handicap. Entry validation only; round-level playing handicaps are not capped by this. */
export const HANDICAP_ENTRY_MIN = -10
export const HANDICAP_ENTRY_MAX = 54
