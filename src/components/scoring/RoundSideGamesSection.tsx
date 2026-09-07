'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'

interface SideCompCompetitor { playerId: string; playerName: string; resultValue: number | null }
interface SideCompRow {
  id: string; compType: string; holeNumber: number | null
  winner: SideCompCompetitor | null
  currentLeader: SideCompCompetitor | null
  isComplete: boolean
}

const SIDE_GAME_LABELS: Record<string, { icon: string; label: string }> = {
  nearest_pin:   { icon: '🎯', label: 'Nearest the Pin' },
  longest_drive: { icon: '💥', label: 'Longest Drive' },
  pros_approach: { icon: '🎯', label: 'Pro\u2019s Approach' },
  powerplay:     { icon: '⚡', label: 'Powerplay' },
}

/**
 * Teein' It Up bug-fix package (7 Sep), item 3 -- "View Results" needed
 * to land on a genuine results experience, which per the brief must
 * include Side Competition winners/results alongside the leaderboard
 * and Makers & Breakers. Reuses the exact same
 * /api/trips/{tripId}/rounds/{roundId}/side-games endpoint My HQ's own
 * organiser-facing Side Games Snapshot already calls (same round-
 * scoped data, same label/icon mapping) -- not a second Side Games
 * calculation or a new API route.
 */
export default function RoundSideGamesSection({
  tripId, roundId,
}: { tripId: string; roundId: string }) {
  const { data } = useQuery<{ competitions: SideCompRow[] }>({
    queryKey: ['side-games-snapshot', tripId, roundId],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/side-games`)
      if (!res.ok) throw new Error('Could not load Side Games.')
      return res.json()
    },
    staleTime: 30000,
  })

  const competitions = data?.competitions ?? []
  if (competitions.length === 0) return null

  return (
    <div style={{ marginTop: 10, background: '#fff', border: '1px solid #eceae3', borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, color: '#14532d', marginBottom: 8 }}>
        🏆 Side Games
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
        {competitions.map(c => {
          const meta = SIDE_GAME_LABELS[c.compType] ?? { icon: '🏆', label: c.compType }
          const leaderOrWinner = c.winner?.playerName ?? c.currentLeader?.playerName
          return (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#374151' }}>
                {meta.icon} {meta.label}{c.holeNumber ? ` · H${c.holeNumber}` : ''}
              </span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: c.isComplete ? '#166534' : '#a1791f' }}>
                {leaderOrWinner ?? 'No claims'}
              </span>
            </div>
          )
        })}
      </div>
      <Link href={`/trips/${tripId}/sidegames`} style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#14532d', textDecoration: 'none' }}>
        View Side Games →
      </Link>
    </div>
  )
}
