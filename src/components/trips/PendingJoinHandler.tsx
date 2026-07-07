'use client'

// Runs once on dashboard mount.
// If a pendingInviteCode exists in sessionStorage (set during /join/[code] flow),
// calls /api/join to add the user to that trip, then redirects to the trip page.
// This completes the join flow when auth redirected through /dashboard instead of
// directly to the trip.

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { tripKeys } from '@/lib/queries/trips'

export default function PendingJoinHandler() {
  const router       = useRouter()
  const queryClient  = useQueryClient()
  const hasRun       = useRef(false)

  useEffect(() => {
    // Only run once per mount — guard against React StrictMode double-fire
    if (hasRun.current) return
    hasRun.current = true

    const code = sessionStorage.getItem('pendingInviteCode')
    if (!code) return

    // Clear immediately to prevent retries on refresh
    sessionStorage.removeItem('pendingInviteCode')

    fetch('/api/join', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ invite_code: code }),
    })
      .then(async (res) => {
        const data = await res.json()
        if (res.ok || res.status === 200) {
          // Invalidate trip list so dashboard refreshes
          void queryClient.invalidateQueries({ queryKey: tripKeys.lists() })
          // Redirect to the trip page
          router.push(`/trips/${data.tripId}`)
        } else {
          console.error('[PendingJoinHandler] join failed:', data.error)
          // Stay on dashboard — trip list will at least show their trips
        }
      })
      .catch((err) => {
        console.error('[PendingJoinHandler] network error:', err)
      })
  }, [router, queryClient])

  return null
}
