'use client'

import React, { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useJoinTrip } from '@/lib/queries/trips'

export default function JoinWelcomeInner() {
  const params     = useParams()
  const router     = useRouter()
  const inviteCode = (params.code as string)?.toUpperCase()
  const joinTrip   = useJoinTrip()

  const [tripName, setTripName] = useState<string | null>(null)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    if (!inviteCode) return

    joinTrip.mutate(inviteCode, {
      onSuccess: (data: { tripName: string; tripId: string }) => {
        setTripName(data.tripName)
        setTimeout(() => router.push(`/trips/${data.tripId}`), 2000)
      },
      onError: (err: Error) => {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      },
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteCode])

  if (error) {
    return (
      <>
        <p className="text-3xl text-center mb-3">⛳</p>
        <h1 className="text-lg font-bold text-text text-center mb-2">Couldn&apos;t join trip</h1>
        <p className="text-text-muted text-sm text-center mb-4">{error}</p>
        <a href="/dashboard" className="block text-center text-sm text-brand-600 hover:underline">Go to My Trips</a>
      </>
    )
  }

  if (tripName) {
    return (
      <>
        <p className="text-4xl text-center mb-3">🎉</p>
        <h1 className="text-xl font-bold text-text text-center mb-2">You&apos;re in!</h1>
        <p className="text-text-muted text-sm text-center mb-4">
          Welcome to <strong className="text-text">{tripName}</strong>. Taking you there now…
        </p>
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin mx-auto" />
      </>
    )
  }

  return (
    <>
      <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin mx-auto mb-4" />
      <p className="text-text-muted text-sm text-center">Joining trip…</p>
    </>
  )
}
