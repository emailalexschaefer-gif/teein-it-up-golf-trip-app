'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { tripKeys } from '@/lib/queries/trips'

export default function PendingJoinHandler() {
  const router      = useRouter()
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const hasRun      = useRef(false)
  const [joinError, setJoinError] = useState<string | null>(null)

  useEffect(() => {
    // Show any joinError from the do-join redirect (e.g. trip not found)
    const rawError = searchParams.get('joinError')
    if (rawError) {
      const known: Record<string, string> = {
        trip_not_found: "We couldn't find that trip. The invite link may have expired.",
        trip_archived:  'This trip is no longer accepting players.',
      }
      setJoinError(known[rawError] ?? decodeURIComponent(rawError))
      // Clean the URL without a full reload
      const url = new URL(window.location.href)
      url.searchParams.delete('joinError')
      window.history.replaceState({}, '', url.toString())
    }
  }, [searchParams])

  useEffect(() => {
    if (hasRun.current) return
    hasRun.current = true

    const code = sessionStorage.getItem('pendingInviteCode')
    if (!code) return
    sessionStorage.removeItem('pendingInviteCode')

    fetch('/api/join', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ invite_code: code }),
    })
      .then(async (res) => {
        const data = await res.json()
        if (res.ok || data.alreadyMember) {
          void queryClient.invalidateQueries({ queryKey: tripKeys.lists() })
          router.push(`/trips/${data.tripId}`)
        } else {
          console.error('[PendingJoinHandler] join failed:', data.error)
          setJoinError(data.error ?? 'Could not complete the trip join. Try entering the code below.')
        }
      })
      .catch((err) => {
        console.error('[PendingJoinHandler] network error:', err)
        setJoinError('Network error while joining trip. Try entering the code below.')
      })
  }, [router, queryClient])

  if (!joinError) return null

  return (
    <div style={{
      background: '#fef2f2', border: '1.5px solid #fca5a5',
      borderRadius: 12, padding: '12px 14px',
    }}>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#b91c1c', fontWeight: 600, marginBottom: 4 }}>
        Could not join trip
      </p>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#dc2626' }}>{joinError}</p>
      <button
        onClick={() => setJoinError(null)}
        style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', marginTop: 6, textDecoration: 'underline', padding: 0 }}
      >
        Dismiss
      </button>
    </div>
  )
}
