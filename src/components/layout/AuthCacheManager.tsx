'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'

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
 * Mounted once, near the app root — has no visual output.
 */
export default function AuthCacheManager() {
  const queryClient = useQueryClient()
  const lastUserIdRef = useRef<string | null | undefined>(undefined) // undefined = not yet observed

  useEffect(() => {
    const supabase = createClient()

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      const currentUserId = session?.user?.id ?? null

      if (event === 'SIGNED_OUT') {
        console.log('[auth-cache] SIGNED_OUT — clearing all cached data')
        queryClient.clear()
        lastUserIdRef.current = null
        return
      }

      if (event === 'SIGNED_IN') {
        const previousUserId = lastUserIdRef.current
        if (previousUserId !== undefined && previousUserId !== null && previousUserId !== currentUserId) {
          // A different account just signed in without an explicit
          // SIGNED_OUT in between (e.g. switching accounts directly) —
          // clear defensively so the new account never sees the old
          // one's cached queries.
          console.log('[auth-cache] account switch detected — clearing all cached data', { previousUserId, currentUserId })
          queryClient.clear()
        }
        lastUserIdRef.current = currentUserId
      }
    })

    return () => subscription.subscription.unsubscribe()
  }, [queryClient])

  return null
}
