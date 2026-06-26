'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useJoinTrip } from '@/lib/queries/trips'
import Button from '@/components/ui/Button'

export default function JoinWelcomePage() {
  const params = useParams()
  const router = useRouter()
  const inviteCode = (params.code as string)?.toUpperCase()
  const joinTrip = useJoinTrip()

  const [state, setState] = useState<'loading' | 'ready' | 'joining' | 'error'>('loading')
  const [tripName, setTripName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Auto-attempt join on mount — check if already a member
  useEffect(() => {
    if (!inviteCode) return

    joinTrip.mutate(inviteCode, {
      onSuccess: (data) => {
        if (data.alreadyMember) {
          // Already in — go straight to trip
          router.replace(`/trips/${data.tripId}`)
        } else {
          setTripName(data.tripName)
          setState('ready')
          // Small delay then auto-redirect
          setTimeout(() => {
            router.push(`/trips/${data.tripId}`)
          }, 2500)
        }
      },
      onError: (err) => {
        setError(err instanceof Error ? err.message : 'Something went wrong')
        setState('error')
      },
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteCode])

  if (state === 'loading' || joinTrip.isPending) {
    return (
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-text-muted text-sm">Joining trip…</p>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="text-center">
        <p className="text-3xl mb-3">⛳</p>
        <h1 className="text-lg font-bold text-text mb-2">Couldn't join trip</h1>
        <p className="text-text-muted text-sm mb-5">{error}</p>
        <a href="/dashboard" className="text-brand-600 text-sm hover:underline">
          Go to My Trips
        </a>
      </div>
    )
  }

  return (
    <div className="text-center">
      <p className="text-4xl mb-3">🎉</p>
      <h1 className="text-xl font-bold text-text mb-2">You're in!</h1>
      {tripName && (
        <p className="text-text-muted text-sm mb-1">
          Welcome to <strong className="text-text">{tripName}</strong>.
        </p>
      )}
      <p className="text-text-subtle text-xs mb-6">Taking you to the trip now…</p>
      <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin mx-auto" />
    </div>
  )
}
