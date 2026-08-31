'use client'

import { useQuery } from '@tanstack/react-query'

interface GolfSummary {
  eventsPlayed: number
  badges: number
  eventWins: number
  sideGameWins: number
}

/**
 * My Golf brief, item 3 — "Home and My Golf must not calculate these
 * independently... create/reuse ONE canonical player-achievements
 * helper." This calls the exact same /api/me/golf-summary endpoint
 * MyGolfSummaryCard.tsx (the Home card) already uses — same
 * queryKey too, so if both happen to be mounted in the same session
 * they'd share one cached result rather than two independent fetches.
 * If Home says "23 Badges," this shows "23 Badges" by construction,
 * not by coincidence.
 */
function Stat({ icon, value, label }: { icon: string; value: number; label: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, color: '#14532d' }}>
        {value}
      </div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#7a7260', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {icon} {label}
      </div>
    </div>
  )
}

export default function MyAchievementsSection() {
  const { data, isLoading } = useQuery<GolfSummary>({
    queryKey: ['my-golf-summary'],
    queryFn: async () => {
      const res = await fetch('/api/me/golf-summary')
      if (!res.ok) throw new Error('Could not load your golf summary.')
      return res.json()
    },
    staleTime: 60000,
  })

  if (isLoading || !data) return null

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 15, fontWeight: 800, marginBottom: 10 }}>
        My Achievements
      </div>
      <div style={{
        background: '#fff', border: '1px solid #eceae3', borderRadius: 14,
        padding: '16px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 16,
      }}>
        <Stat icon="⛳" value={data.eventsPlayed} label="Events Played" />
        <Stat icon="🏅" value={data.badges} label="Badges" />
        <Stat icon="🏆" value={data.eventWins} label="Event Wins" />
        <Stat icon="🎯" value={data.sideGameWins} label="Side Game Wins" />
      </div>
    </div>
  )
}
