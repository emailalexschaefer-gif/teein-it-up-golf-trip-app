'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'

interface MyRoundData {
  hasScorecard: boolean
  status?: string
  totalPts?: number; holesPlayed?: number; totalHoles?: number
  position?: number; totalPlayers?: number
  markerName?: string | null
  mismatches?: { hole: number }[]
}

export default function MyRoundSummary({ tripId, roundId, roundStatus }: { tripId: string; roundId: string; roundStatus: string }) {
  // Same query key and endpoint as the full PlayerRoundView — if a user
  // ever views both (unlikely, but not impossible), React Query dedupes
  // the request rather than fetching twice.
  const { data } = useQuery<MyRoundData>({
    queryKey: ['my-round', tripId, roundId],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/my-round`)
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    refetchInterval: roundStatus === 'active' ? 8000 : false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  })

  if (!data || !data.hasScorecard) return null

  const hasMismatch = (data.mismatches?.length ?? 0) > 0

  return (
    <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', padding: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 800, color: '#14532d' }}>{data.totalPts ?? 0}</div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, color: '#9ca3af' }}>Points</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 800, color: '#14532d' }}>{data.holesPlayed ?? 0}/{data.totalHoles ?? 18}</div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, color: '#9ca3af' }}>Holes</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 800, color: '#14532d' }}>{data.position ? `${data.position}/${data.totalPlayers}` : '—'}</div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, color: '#9ca3af' }}>Position</div>
        </div>
      </div>

      {data.markerName && (
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af', textAlign: 'center', marginBottom: 10 }}>
          Marked by {data.markerName}
        </div>
      )}

      {hasMismatch && (
        <Link href={`/trips/${tripId}/rounds/${roundId}?hole=${data.mismatches![0].hole}`} style={{
          display: 'block', textAlign: 'center', padding: 9, borderRadius: 8, marginBottom: 8,
          background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626',
          fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12, textDecoration: 'none',
        }}>
          ⚠ Hole {data.mismatches![0].hole} needs review →
        </Link>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <Link href={`/trips/${tripId}/rounds/${roundId}`} style={{
          flex: 1, textAlign: 'center', padding: 10, borderRadius: 8,
          background: '#14532d', color: '#fff', fontFamily: 'var(--font-body)',
          fontWeight: 700, fontSize: 12.5, textDecoration: 'none',
        }}>
          Continue Scoring
        </Link>
        <Link href={`/trips/${tripId}/leaderboard`} style={{
          flex: 1, textAlign: 'center', padding: 10, borderRadius: 8,
          background: '#ffffff', border: '1.5px solid #d1d5db', color: '#14532d',
          fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5, textDecoration: 'none',
        }}>
          View My Scorecard
        </Link>
      </div>
    </div>
  )
}
