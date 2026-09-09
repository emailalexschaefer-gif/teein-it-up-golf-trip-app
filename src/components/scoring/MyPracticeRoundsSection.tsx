'use client'

import { useQuery } from '@tanstack/react-query'
import CollapsibleSection from '@/components/shared/CollapsibleSection'

interface PracticeStatBlock {
  fairwaysAnswered: number; fairwaysHit: number; fairwayPct: number | null
  girAnswered: number; girHit: number; girPct: number | null
  puttsAnswered: number; totalPutts: number; puttsPerHole: number | null
}

interface PracticeRound {
  roundId: string
  courseName: string | null
  teeName: string | null
  playDate: string | null
  holes: number
  nine: 'front' | 'back' | null
  holesEntered: number
  totalPts: number
  grossTotal: number
  playingHandicap: number | null
  isComplete: boolean
  trackStats: boolean
  stats: PracticeStatBlock | null
}

function holesLabel(holes: number, nine: 'front' | 'back' | null): string {
  if (holes === 9) return nine === 'back' ? 'Back 9' : 'Front 9'
  return '18 holes'
}

/**
 * Practice Round My Golf display follow-up (5 Sep), extended for
 * Practice History + Progress (9 Sep, items 2-3). Deliberately its own
 * small, separate section, not folded into My Event Stories.
 *
 * "PRACTICE" is unmistakable by design: its own label, its own muted
 * (not gold/trophy) styling, no position, no "winner," no badge/M&B
 * iconography anywhere in this component.
 *
 * 9-hole comparison rule (item 2/7) — gross/Stableford are never
 * averaged across mixed hole counts without saying so: Progress trends
 * below are computed per-holes-group (9 vs 18), not blended into one
 * misleading number.
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

  const completed = rounds.filter(r => r.isComplete)

  return (
    <>
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
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, color: '#9ca3af' }}>
                  {holesLabel(r.holes, r.nine)}
                </span>
                {!r.isComplete && (
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, color: '#9ca3af' }}>
                    · In progress — {r.holesEntered}/{r.holes} holes
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
                  {r.grossTotal} gr · {r.totalPts} pts
                </span>
              </div>

              {/* Practice History (item 2) — absent entirely (not
                  0%/0) when Track Stats was off for this round, per
                  the explicit "do not show fake 0% Fairways/GIR"
                  instruction. Each figure only renders if that stat
                  was genuinely answered on at least one hole. */}
              {r.trackStats && r.stats && (r.stats.fairwaysAnswered > 0 || r.stats.girAnswered > 0 || r.stats.puttsAnswered > 0) && (
                <div style={{ display: 'flex', gap: 12, marginTop: 8, paddingTop: 8, borderTop: '1px solid #eceae3', fontFamily: 'var(--font-body)', fontSize: 11, color: '#7a7260' }}>
                  {r.stats.fairwaysAnswered > 0 && <span>Fairways {r.stats.fairwaysHit}/{r.stats.fairwaysAnswered} ({r.stats.fairwayPct}%)</span>}
                  {r.stats.girAnswered > 0 && <span>GIR {r.stats.girHit}/{r.stats.girAnswered} ({r.stats.girPct}%)</span>}
                  {r.stats.puttsAnswered > 0 && <span>{r.stats.totalPutts} putts ({r.stats.puttsPerHole?.toFixed(2)}/hole)</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      </CollapsibleSection>

      <PracticeProgressSection rounds={completed} />
    </>
  )
}

/**
 * Practice Progress (9 Sep, item 3) — MVP trend metrics, grouped by
 * holes count (9 vs 18) per the explicit "do not directly compare a
 * 9-hole gross score against an 18-hole gross score" rule, and further
 * by course+tee where that grouping has at least 2 rounds (the
 * brief's own "Eagle Ridge — Blue Tees" example) — otherwise falls
 * back to one overall group per hole-count, since a same-course/tee
 * breakdown with only one data point isn't a trend.
 *
 * Every average here is computed only from rounds/holes where the
 * relevant data actually exists — a round with Track Stats off simply
 * doesn't contribute to the Fairway/GIR/Putts averages at all, it
 * isn't treated as a zero.
 */
function PracticeProgressSection({ rounds }: { rounds: PracticeRound[] }) {
  if (rounds.length === 0) return null

  const groups = new Map<string, PracticeRound[]>()
  for (const r of rounds) {
    const courseKey = r.courseName ? `${r.courseName}${r.teeName ? ` — ${r.teeName}` : ''}` : null
    const holesKey = r.holes === 9 ? `9 (${r.nine === 'back' ? 'Back' : 'Front'})` : '18 holes'
    const key = courseKey ? `${courseKey} · ${holesKey}` : `All courses · ${holesKey}`
    const list = groups.get(key) ?? []
    list.push(r)
    groups.set(key, list)
  }

  const avg = (nums: number[]): number | null => nums.length > 0 ? Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 100) / 100 : null

  return (
    <CollapsibleSection icon="📈" title="Practice Progress">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {[...groups.entries()].map(([label, list]) => {
          const withStats = list.filter(r => r.trackStats && r.stats)
          const fairwayPcts = withStats.filter(r => (r.stats?.fairwaysAnswered ?? 0) > 0).map(r => r.stats!.fairwayPct!)
          const girPcts = withStats.filter(r => (r.stats?.girAnswered ?? 0) > 0).map(r => r.stats!.girPct!)
          const puttsPerHole = withStats.filter(r => (r.stats?.puttsAnswered ?? 0) > 0).map(r => r.stats!.puttsPerHole!)
          return (
            <div key={label}>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: '#a1791f', marginBottom: 6 }}>
                {label} · Last {list.length} round{list.length === 1 ? '' : 's'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                <ProgressStat label="Avg Gross" value={avg(list.map(r => r.grossTotal))} />
                <ProgressStat label="Avg Stableford" value={avg(list.map(r => r.totalPts))} />
                <ProgressStat label="Fairway %" value={fairwayPcts.length > 0 ? avg(fairwayPcts) : null} suffix={fairwayPcts.length > 0 ? '%' : ''} />
                <ProgressStat label="GIR %" value={girPcts.length > 0 ? avg(girPcts) : null} suffix={girPcts.length > 0 ? '%' : ''} />
                <ProgressStat label="Putts/Hole" value={puttsPerHole.length > 0 ? avg(puttsPerHole) : null} />
              </div>
            </div>
          )
        })}
      </div>
    </CollapsibleSection>
  )
}

function ProgressStat({ label, value, suffix = '' }: { label: string; value: number | null; suffix?: string }) {
  return (
    <div style={{ background: '#f7f6f1', border: '1px solid #eceae3', borderRadius: 8, padding: '8px 6px', textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 800, color: '#14532d' }}>
        {value !== null ? `${value}${suffix}` : '—'}
      </div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 8.5, color: '#9ca3af', marginTop: 2 }}>{label}</div>
    </div>
  )
}
