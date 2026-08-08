/**
 * Pure decision logic for whether an auth event should clear the React
 * Query cache. `previousUserId` uses `undefined` to mean "not yet
 * observed" (the very first auth event since the app loaded), distinct
 * from `null` ("we've seen this browser signed out before") — only a
 * genuine account switch (a different real user ID replacing another)
 * or an explicit sign-out should trigger a clear; the first-ever
 * SIGNED_IN on a fresh page load must not.
 */
export function shouldClearCacheOnAuthEvent(
  event: string,
  previousUserId: string | null | undefined,
  currentUserId: string | null,
): boolean {
  if (event === 'SIGNED_OUT') return true
  if (event === 'SIGNED_IN') {
    return previousUserId !== undefined && previousUserId !== null && previousUserId !== currentUserId
  }
  return false
}

/**
 * True when a pageshow event fired because the browser restored a
 * bfcached page, rather than a normal navigation/load. This is the
 * standard, documented signal (MDN, web.dev) for detecting this exact
 * condition — the confirmed root cause of the mobile account-switch
 * bug: when Chrome restores a page from bfcache (common on mobile after
 * backgrounding/switching apps, which is a normal part of an
 * account-switch flow), it reuses the entire prior JS execution context
 * wholesale rather than re-running anything. Every closure — including
 * the Sign Out button's onClick, still referencing whichever
 * supabase/queryClient instances existed at the moment the page was
 * cached — is exactly as stale as the data it's bound to.
 */
export function isBfcacheRestore(event: { persisted: boolean }): boolean {
  return event.persisted === true
}
