'use client'

import { useQuery } from '@tanstack/react-query'

interface SideGameStatus {
  sideCompId: string; compType: string; icon: string; label: string
  holeNumber: number | null; status: 'current_leader' | 'result_entered'
}

/**
 * My Golf Side Games -- live status (9 Sep), item 4. Mounted inside
 * Recap Round, between What Happened Today and My Moments. Reads only
 * -- never shows "Winner" (that belongs to round history once a round
 * has actually closed), and never mutates anything itself.
 */
export default function MySideGamesSection({ tripId, roundId }: { tripId: string; roundId: string }) {
  const { data } = useQuery<{ sideGames: SideGameStatus[] }>({
    queryKey: ['my-side-games', tripId, roundId],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/my-side-games`)
      if (!res.ok) throw new Error('Could not load Side Games status.')
      return res.json()
    },
    staleTime: 15000,
  })

  const games = data?.sideGames ?? []
  if (games.length === 0) return null

  return (
    <>
      <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, color: '#14532d', marginTop: 16, marginBottom: 8 }}>
        My Side Games
      </div>
      <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden', marginBottom: 16 }}>
        {games.map((g, i) => (
          <div key={g.sideCompId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: i < games.length - 1 ? '1px solid #f3f4f1' : 'none' }}>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#374151' }}>
              {g.icon} {g.label}{g.holeNumber ? ` · H${g.holeNumber}` : ''}
            </span>
            <span style={{
              fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700,
              color: g.status === 'current_leader' ? '#166534' : '#a1791f',
            }}>
              {g.status === 'current_leader' ? 'Current Leader' : 'Result Entered'}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}
