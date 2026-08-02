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
        position: 'fixed',
        // 64px = AppNav's own sticky height (h-16), plus safe-area-inset-top
        // for notched devices, plus an 8px gap so it doesn't sit flush
        // against the header. Fixed positioning is what makes "never
        // alter page layout" true — this was previously a normal-flow
        // element that pushed the trip header down and visually
        // overlapped it; now it floats independently of document flow.
        top: 'calc(64px + env(safe-area-inset-top, 0px) + 8px)',
        left: '50%', transform: 'translateX(-50%)',
        width: 'calc(100% - 32px)', maxWidth: 480, height: 64,
        zIndex: 90,
        padding: '10px 14px', borderRadius: 12,
        background: 'linear-gradient(135deg,#14532d,#1a6b3a)',
        border: '1.5px solid #e8c96a', boxShadow: '0 6px 20px rgba(0,0,0,0.3)',
        display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
        boxSizing: 'border-box',
      }}
    >
      <span style={{ fontSize: 20, flexShrink: 0 }}>🟢</span>
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div style={{ fontFamily: 'var(--font-body)', color: '#fff', fontWeight: 800, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {roundName} has started!
        </div>
        <div style={{ fontFamily: 'var(--font-body)', color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
