// Public leaderboard refresh policy (26 Oct field test). Pure so it can be tested without a browser.
// Before: polled every 30s while the CDN could serve a response up to 15s old plus 30s stale-while-revalidate, so a
// spectator could be ~75s behind -- long enough to look like "it never refreshes".

/** How often a visible page asks for fresh standings. Requirement: roughly every 10-15 seconds. */
export const LEADERBOARD_POLL_MS = 12000
/** Longest wait between attempts while the connection is failing (keeps server load bounded). */
export const LEADERBOARD_MAX_BACKOFF_MS = 60000
/** CDN may share one computation between viewers for this long, and NO stale-while-revalidate window. */
export const PUBLIC_LEADERBOARD_CACHE = 'public, s-maxage=5'

/** 12s normally; doubles after each consecutive failure (12, 24, 48, 60 ...). */
export function nextPollDelay(consecutiveFailures: number): number {
  if (!Number.isFinite(consecutiveFailures) || consecutiveFailures <= 0) return LEADERBOARD_POLL_MS
  return Math.min(LEADERBOARD_MAX_BACKOFF_MS, LEADERBOARD_POLL_MS * 2 ** Math.min(consecutiveFailures, 6))
}

/**
 * Discreet "trouble refreshing" indicator: only after two failures in a row (one dropped request is not news),
 * or when nothing has succeeded for 90 seconds.
 */
export function isRefreshStale(consecutiveFailures: number, msSinceLastSuccess: number | null): boolean {
  if (consecutiveFailures >= 2) return true
  return msSinceLastSuccess !== null && msSinceLastSuccess > 90000
}
