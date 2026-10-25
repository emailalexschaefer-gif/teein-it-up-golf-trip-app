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
      try {
        const res = await fetch(`/api/trips/${tripId}/share-leaderboard`, { cache: 'no-store' })
        if (res.status === 401 || res.status === 403 || res.status === 404) return { available: false } as ShareStatus // signed out / not a member
        if (!res.ok) return { available: true, unavailable: true, error: 'Could not check the live link right now. You can still save an image or PDF.' } as ShareStatus
        return await res.json()
      } catch { return { available: true, unavailable: true, error: 'Could not check the live link right now. Check your connection. You can still save an image or PDF.' } as ShareStatus }
    },
    staleTime: 0,
  })
  if (!data?.available) return null
  return (
    <>
      <button
        onClick={() => setOpen(true)} aria-label="Share leaderboard"
        style={{ marginLeft: 'auto', minHeight: 44, padding: '0 14px', borderRadius: 12, border: '1.5px solid #a1791f', background: 'linear-gradient(180deg,#f0d27a,#e0b43a)', color: '#14532d', fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 14, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, boxShadow: '0 2px 8px rgba(161,121,31,0.35)' }}
      >
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 10.6l6.8-4M8.6 13.4l6.8 4" /></svg>
        Share
      </button>
      {open && <ShareLeaderboardPanel tripId={tripId} status={data} onClose={() => setOpen(false)} />}
    </>
  )
}
