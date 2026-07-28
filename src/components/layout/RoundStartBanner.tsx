'use client'

// Field-tested feedback: players had no clear signal that a round had
// started beyond noticing it themselves. This banner surfaces it directly.
// Reuses the EXISTING my-scores endpoint to get the current user's marker
// name for this round — no new API created for this.

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'

interface MyScoresResponse {
  markedByName?: string | null
}

export default function RoundStartBanner({
  tripId, roundId, roundName,
}: { tripId: string; roundId: string; roundName: string }) {
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const [dismissed, setDismissed] = useState(true) // default hidden until sessionStorage check resolves, avoids a flash

  const scoringUrl = `/trips/${tripId}/rounds/${roundId}`
  // Don't show the "tap to begin scoring" banner while already on that
  // exact round's scoring screen — redundant and in the way there.
  const onThisRoundAlready = pathname.startsWith(scoringUrl)

  useEffect(() => {
    const key = `round-start-dismissed:${roundId}`
    setDismissed(sessionStorage.getItem(key) === '1')
  }, [roundId])

  const { data } = useQuery<MyScoresResponse>({
    queryKey: ['my-scores', tripId, roundId],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/my-scores`)
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    enabled: !dismissed && !onThisRoundAlready,
    staleTime: 60000,
  })

  if (dismissed || onThisRoundAlready) return null

  function dismiss() {
    sessionStorage.setItem(`round-start-dismissed:${roundId}`, '1')
    setDismissed(true)
  }

  return (
    <div
      onClick={() => router.push(scoringUrl)}
      style={{
        margin: '10px 16px 0', padding: '12px 14px', borderRadius: 12,
        background: 'linear-gradient(135deg,#14532d,#1a6b3a)',
        border: '1.5px solid #e8c96a', boxShadow: '0 4px 16px rgba(20,83,45,0.25)',
        display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
      }}
    >
      <span style={{ fontSize: 20, flexShrink: 0 }}>🟢</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-body)', color: '#fff', fontWeight: 800, fontSize: 13.5 }}>
          {roundName} has started!
        </div>
        <div style={{ fontFamily: 'var(--font-body)', color: 'rgba(255,255,255,0.75)', fontSize: 11.5, marginTop: 1 }}>
          {data?.markedByName ? `Your marker is ${data.markedByName}. ` : ''}Tap to begin scoring →
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); dismiss() }}
        aria-label="Dismiss"
        style={{ flexShrink: 0, background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 16, padding: 4, cursor: 'pointer' }}
      >
        ✕
      </button>
    </div>
  )
}
