export const TRIP_INFORMATION_MAX_LENGTH = 20000

export interface TripInformationValidation {
  ok: boolean
  error?: string
  normalised?: string | null
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
