'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

interface AuthUserState {
  user: User | null
  authResolved: boolean
}

/**
 * Tracks the current authenticated user reactively — the initial check via
 * getUser(), then kept in sync via onAuthStateChange (SIGNED_IN,
 * SIGNED_OUT, TOKEN_REFRESHED, etc.). This is what lets a query be scoped
 * to "the actual current user" rather than whatever user was logged in
 * when the query first ran, which was the root cause of trips data
 * surviving an account switch.
 *
 * `authResolved` is a distinct state from `user` being null — it answers
 * "have we actually checked yet," not just "is there a user." Consumers
 * (like useMyTrips) should gate on authResolved, not just user, so a
 * query never runs against a not-yet-confirmed session, and so loading
 * UI can show "figuring out who you are" separately from "loading your
 * data" instead of collapsing both into one indistinguishable skeleton.
 *
 * A 5s hard timeout guarantees authResolved always becomes true even if
 * the initial getUser() call hangs — the same principle as the server-
 * layout timeout fix from the previous stability pass, applied here on
 * the client so this can never be the source of an indefinite skeleton.
 */
export function useAuthUser(): AuthUserState {
  const [state, setState] = useState<AuthUserState>({ user: null, authResolved: false })

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()

    const timeoutId = setTimeout(() => {
      if (!cancelled) setState(s => (s.authResolved ? s : { ...s, authResolved: true }))
    }, 5000)

    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return
      clearTimeout(timeoutId)
      setState({ user: data.user ?? null, authResolved: true })
    }).catch(() => {
      if (cancelled) return
      clearTimeout(timeoutId)
      setState({ user: null, authResolved: true })
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return
      setState({ user: session?.user ?? null, authResolved: true })
    })

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
      subscription.subscription.unsubscribe()
    }
  }, [])

  return state
}
