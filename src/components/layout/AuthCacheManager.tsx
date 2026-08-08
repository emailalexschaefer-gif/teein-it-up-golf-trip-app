'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { shouldClearCacheOnAuthEvent, isBfcacheRestore } from '@/lib/auth/authCacheLogic'

/**
 * Clears the entire React Query cache on sign-out and on an account
 * switch (a SIGNED_IN event where the user ID differs from whoever was
 * last signed in). This is the actual fix for "logs in as a different
 * user and inherits the previous account's data" — a single QueryClient
 * instance persists for the whole app lifetime (it's created once in
 * ReactQueryProvider and isn't remounted on client-side navigation), so
 * without this, cached queries from the old account simply keep existing
 * and can be served to the new one before their own fetch completes.
 *
 * Deliberately a full clear(), not a surgical removal of specific keys —
 * this is a security/correctness boundary (never show one account's
 * data to another), not a performance optimization, so erring toward
 * "clear everything" is the correct default even though it means a
 * brief refetch cost right after switching accounts.
 *
 * Also handles back/forward-cache (bfcache) restoration — see
 * isBfcacheRestore above. This is the confirmed root cause of the
 * mobile account-switch bug: when Chrome restores a page from bfcache
 * (common on mobile after backgrounding/switching apps, which is a
 * normal part of an account-switch flow — e.g. leaving the app to check
 * an email or open account settings, then returning), it reuses the
 * entire prior JS execution context wholesale rather than re-running
 * anything. Every closure — including the Sign Out button's onClick,
 * still referencing whichever `supabase`/`queryClient` instances existed
 * at the moment the page was cached — is exactly as stale as the data
 * it's bound to. This is a real browser behavior affecting any browser,
 * not a mobile-only quirk; it's simply triggered far more often on
 * mobile, where OS-level app-switching interacts with bfcache much more
 * readily than typical desktop usage.
 *
 * Mounted once, near the app root — has no visual output.
 */
export default function AuthCacheManager() {
  const queryClient = useQueryClient()
  const lastUserIdRef = useRef<string | null | undefined>(undefined) // undefined = not yet observed

  useEffect(() => {
    const supabase = createClient()

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      const currentUserId = session?.user?.id ?? null
      const previousUserId = lastUserIdRef.current

      if (shouldClearCacheOnAuthEvent(event, previousUserId, currentUserId)) {
        console.log('[auth-cache] clearing all cached data', { event, previousUserId, currentUserId })
        queryClient.clear()
      }

      if (event === 'SIGNED_OUT') {
        lastUserIdRef.current = null
      } else if (event === 'SIGNED_IN') {
        lastUserIdRef.current = currentUserId
      }
    })

    // The actual fix for the mobile account-switch bug — see the
    // component-level comment above for the full root-cause reasoning.
    function handlePageShow(event: PageTransitionEvent) {
      if (isBfcacheRestore(event)) {
        console.log('[auth-cache] page restored from bfcache — forcing reload to resync session state')
        window.location.reload()
      }
    }
    window.addEventListener('pageshow', handlePageShow)

    return () => {
      subscription.subscription.unsubscribe()
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [queryClient])

  return null
}
