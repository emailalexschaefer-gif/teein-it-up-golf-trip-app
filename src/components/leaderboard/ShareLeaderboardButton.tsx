'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import ShareLeaderboardPanel, { type ShareStatus } from './ShareLeaderboardPanel'

// "Share Leaderboard" for every event participant. Renders nothing for events
// that cannot be shared (practice rounds) and while the status is loading.
export default function ShareLeaderboardButton({ tripId }: { tripId: string }) {
  const [open, setOpen] = useState(false)
  const { data } = useQuery<ShareStatus>({
    queryKey: ['share-leaderboard', tripId],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/share-leaderboard`, { cache: 'no-store' })
      if (!res.ok) return { available: false } as ShareStatus
      return res.json()
    },
    staleTime: 0,
  })
  if (!data?.available) return null
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{ marginLeft: 'auto', minHeight: 40, padding: '0 14px', borderRadius: 10, border: 'none', background: '#14532d', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        <span aria-hidden="true">{'↗'}</span> Share Leaderboard
      </button>
      {open && <ShareLeaderboardPanel tripId={tripId} status={data} onClose={() => setOpen(false)} />}
    </>
  )
}
