'use client'

import { useQuery } from '@tanstack/react-query'
import CollapsibleSection from '@/components/shared/CollapsibleSection'

interface PracticeRound {
  roundId: string
  courseName: string | null
  teeName: string | null
  playDate: string | null
  holes: number | null
  holesEntered: number
  totalPts: number
  playingHandicap: number | null
  isComplete: boolean
}

/**
 * Practice Round My Golf display follow-up (5 Sep) -- the one thing
 * this pass exists to add. Deliberately its own small, separate
 * section, not folded into My Event Stories -- that section is
 * explicitly Event-only, per the earlier pass's own comment on its
 * query, and the brief itself says not to force Practice into it.
 *
 * "PRACTICE" is unmistakable by design: its own label, its own muted
 * (not gold/trophy) styling, and deliberately no position, no
 * "winner," no badge/M&B iconography anywhere in this component --
 * only the four data points the brief actually asked for (course,
 * date, holes, points), plus handicap where known.
 */
export default function MyPracticeRoundsSection() {
  const { data } = useQuery<{ practiceRounds: PracticeRound[] }>({
    queryKey: ['my-practice-rounds'],
    queryFn: async () => {
      const res = await fetch('/api/me/practice-rounds')
      if (!res.ok) throw new Error('Could not load practice rounds.')
      return res.json()
    },
    staleTime: 30000,
  })

  const rounds = data?.practiceRounds ?? []
  if (rounds.length === 0) return null

  return (
    <CollapsibleSection icon="⛳" title="Practice Rounds" count={rounds.length}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rounds.map(r => (
          <div
            key={r.roundId}
            style={{ background: '#f7f6f1', border: '1px solid #eceae3', borderRadius: 10, padding: '12px 14px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{
                fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 800, letterSpacing: 0.6,
                color: '#7a7260', background: '#eceae3', borderRadius: 5, padding: '2px 7px',
              }}>
                PRACTICE
              </span>
              {!r.isComplete && (
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, color: '#9ca3af' }}>
                  In progress — {r.holesEntered}/{r.holes ?? 18} holes
                </span>
              )}
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: '#14532d' }}>
              {r.courseName || 'Practice Round'}{r.teeName ? ` · ${r.teeName}` : ''}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#6b7280' }}>
                {r.playDate ? new Date(r.playDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                {r.playingHandicap != null ? ` · HCP ${r.playingHandicap}` : ''}
              </span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 800, color: '#14532d' }}>
                {r.totalPts} pts
              </span>
            </div>
          </div>
        ))}
      </div>
    </CollapsibleSection>
  )
}
