/**
 * Homepage "My Golf" summary — "View My Golf →" link target.
 *
 * My Golf is genuinely a per-trip experience in this app
 * (/trips/[tripId]/tournament); there is no separate global cross-trip
 * page. Picks the single most sensible existing destination: a
 * currently live/ready/open trip takes priority over a completed one
 * (a player mid-event should land on their actual current round, not
 * stale history), and among ties, the most recently updated trip wins.
 */
export interface TripMembershipForRecency {
  tripId: string
  status: string
  updatedAt: string
}

const ACTIVE_STATUSES = ['live', 'ready', 'open']

export function selectMostRecentTrip(memberships: TripMembershipForRecency[]): string | null {
  if (memberships.length === 0) return null
  const sorted = [...memberships].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const activeFirst = sorted.find(m => ACTIVE_STATUSES.includes(m.status))
  return activeFirst?.tripId ?? sorted[0].tripId
}
