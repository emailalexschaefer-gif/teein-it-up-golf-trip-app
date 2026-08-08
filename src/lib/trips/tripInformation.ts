export const TRIP_INFORMATION_MAX_LENGTH = 20000

export interface TripInformationValidation {
  ok: boolean
  error?: string
  normalised?: string | null
}

export interface TripInformationPreview {
  text: string
  exceedsPreview: boolean
}

/**
 * Computes the collapsed-state preview for Trip Information — the first
 * `maxLines` logical lines (split on the same newlines the organiser
 * typed/pasted), joined back with the same separator so whitespace-
 * preserving rendering (white-space: pre-wrap) displays it identically
 * to a real prefix of the full text. Never mutates or truncates the
 * underlying data; this is purely a display-time computation the caller
 * re-derives from the full text on every render.
 *
 * exceedsPreview is what a caller uses to decide whether to show the
 * expand/collapse toggle at all — false for text that already fits
 * within maxLines, per the explicit "do not show it unnecessarily"
 * requirement.
 */
export function computeTripInformationPreview(info: string, maxLines: number = 10): TripInformationPreview {
  const lines = info.split('\n')
  if (lines.length <= maxLines) {
    return { text: info, exceedsPreview: false }
  }
  return { text: lines.slice(0, maxLines).join('\n'), exceedsPreview: true }
}

/**
 * Validates and normalises a trip_information value before it's written
 * to the database. Extracted as a pure function (no request/response
 * objects, no database access) specifically so this logic is directly
 * unit-testable — the API route just calls this and maps the result to
 * an HTTP response.
 *
 * Normalisation: an empty or whitespace-only string is stored as null
 * (the documented empty state), not as an empty string — so "the
 * organiser typed something then deleted it all" and "nothing was ever
 * entered" are the same state, not two different ones a query would
 * need to handle separately.
 */
export function validateTripInformation(value: unknown): TripInformationValidation {
  if (value === null) return { ok: true, normalised: null }
  if (typeof value !== 'string') {
    return { ok: false, error: 'trip_information must be a string or null.' }
  }
  if (value.length > TRIP_INFORMATION_MAX_LENGTH) {
    return { ok: false, error: `Trip Information is too long (${TRIP_INFORMATION_MAX_LENGTH.toLocaleString()} character limit).` }
  }
  const normalised = value.trim() === '' ? null : value
  return { ok: true, normalised }
}
