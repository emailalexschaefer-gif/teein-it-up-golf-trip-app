/**
 * Crucial MVP Onboarding Update — validation for the Player/Organiser/
 * Both segmentation. Extracted from /api/me/intent's own inline
 * validation so it's independently testable — this is the one part of
 * that route with genuine branching logic worth covering.
 */

export type UserIntent = 'player' | 'organiser' | 'both'

export const VALID_USER_INTENTS: UserIntent[] = ['player', 'organiser', 'both']
export const VALID_ORGANISER_TYPES = ['golf_trips', 'social_golf', 'corporate', 'club_community', 'other'] as const

export function isValidUserIntent(value: unknown): value is UserIntent {
  return typeof value === 'string' && (VALID_USER_INTENTS as string[]).includes(value)
}

/**
 * organiser_types is only ever meaningful for 'organiser'/'both' — for
 * 'player', this always returns null regardless of what was sent,
 * since the follow-up question is never even shown for that answer.
 * Unknown values are silently dropped rather than rejecting the whole
 * request — a genuinely valid intent selection should never fail to
 * save because of one bad entry in an optional array.
 */
export function sanitizeOrganiserTypes(intent: UserIntent, rawTypes: unknown): string[] | null {
  if (intent === 'player') return null
  if (!Array.isArray(rawTypes)) return null
  const cleaned = rawTypes.filter((t): t is string => typeof t === 'string' && (VALID_ORGANISER_TYPES as readonly string[]).includes(t))
  return cleaned.length > 0 ? cleaned : null
}
