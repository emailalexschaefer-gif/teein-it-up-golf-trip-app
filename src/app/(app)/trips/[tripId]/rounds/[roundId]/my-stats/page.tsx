'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface StatsResponse {
  trackStats: boolean
  totalHoles: number
  summary: {
    holesCompleted: number; grossTotal: number; stablefordTotal: number
    fairwaysEligible: number; fairwaysAnswered: number; fairwaysHit: number; fairwayPct: number | null
    girAnswered: number; girHit: number; girPct: number | null
    puttsAnswered: number; totalPutts: number; puttsPerHole: number | null
  }
  perHole: { holeNumber: number; par: number; gross: string; pts: number | null; fairwayHit: boolean | null; gir: boolean | null; putts: number | null }[]
}

/**
 * Practice V2 (8 Sep), items 4-5 -- "My Stats" (stats enabled) / "My
 * Round" (stats disabled), replacing the Leaderboard nav slot for
 * Practice entirely. Never a fake one-player leaderboard -- this reads
 * the exact same /my-stats aggregation the Practice Summary screen
 * will also read, so the two can never disagree.
 */
export default function MyStatsPage() {
  const params = useParams<{ tripId: string; roundId: string }>()
  const [data, setData] = useState<StatsResponse | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const poll = () => {
      fetch(`/api/trips/${params.tripId}/rounds/${params.roundId}/my-stats`)
        .then(res => res.json().then(body => ({ ok: res.ok, body })))
        .then(({ ok, body }) => { if (!cancelled) { if (ok) setData(body); else setError(body.error ?? 'Could not load.') } })
        .catch(() => { if (!cancelled) setError('Could not load your stats.') })
    }
    poll()
    const interval = setInterval(poll, 8000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [params.tripId, params.roundId])

  if (error) return <div style={{ padding: 20, textAlign: 'center', fontFamily: 'var(--font-body)', color: '#9ca3af' }}>{error}</div>
  if (!data) return <div style={{ padding: 20, textAlign: 'center', fontFamily: 'var(--font-body)', color: '#9ca3af' }}>Loading…</div>

  const { summary, perHole, trackStats, totalHoles } = data

  const statCard = (label: string, value: string) => (
    <div style={{ background: '#fff', border: '1px solid #eceae3', borderRadius: 10, padding: '10px 8px', textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, color: '#14532d' }}>{value}</div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 9.5, color: '#9ca3af', marginTop: 2 }}>{label}</div>
    </div>
  )

  return (
    <div style={{ padding: '16px 16px 32px', maxWidth: 480, margin: '0 auto' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, color: '#14532d', marginBottom: 14 }}>
        {trackStats ? '📊 My Stats' : '⛳ My Round'}
      </h1>

      <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#a1791f', letterSpacing: 0.5, marginBottom: 8 }}>ROUND</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 18 }}>
        {statCard('Gross', String(summary.grossTotal))}
        {statCard('Stableford', String(summary.stablefordTotal))}
        {statCard('Holes', `${summary.holesCompleted}/${totalHoles}`)}
      </div>

      {trackStats && (
        <>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#a1791f', letterSpacing: 0.5, marginBottom: 8 }}>ACCURACY</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 18 }}>
            {statCard('Fairways', summary.fairwaysAnswered > 0 ? `${summary.fairwaysHit}/${summary.fairwaysAnswered}` : '—')}
            {statCard('Fairway %', summary.fairwayPct !== null ? `${summary.fairwayPct}%` : '—')}
            {statCard('GIR', summary.girAnswered > 0 ? `${summary.girHit}/${summary.girAnswered}` : '—')}
            {statCard('GIR %', summary.girPct !== null ? `${summary.girPct}%` : '—')}
          </div>

          <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#a1791f', letterSpacing: 0.5, marginBottom: 8 }}>PUTTING</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 18 }}>
            {statCard('Total Putts', summary.puttsAnswered > 0 ? String(summary.totalPutts) : '—')}
            {statCard('Putts/Hole', summary.puttsPerHole !== null ? summary.puttsPerHole.toFixed(2) : '—')}
          </div>
        </>
      )}

      <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#a1791f', letterSpacing: 0.5, marginBottom: 8 }}>SCORECARD</div>
      <div style={{ background: '#fff', border: '1px solid #eceae3', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ display: 'flex', padding: '6px 10px', background: '#f7f6f1', fontFamily: 'var(--font-body)', fontSize: 9.5, fontWeight: 700, color: '#9ca3af' }}>
          <span style={{ width: 30 }}>H</span><span style={{ width: 28 }}>PAR</span><span style={{ width: 32 }}>GR</span><span style={{ width: 30 }}>PTS</span>
          {trackStats && <><span style={{ width: 30 }}>FW</span><span style={{ width: 30 }}>GIR</span><span style={{ width: 28 }}>PT</span></>}
        </div>
        {perHole.map(h => (
          <div key={h.holeNumber} style={{ display: 'flex', padding: '6px 10px', borderTop: '1px solid #f3f4f1', fontFamily: 'var(--font-body)', fontSize: 11.5 }}>
            <span style={{ width: 30, fontWeight: 700, color: '#14532d' }}>{h.holeNumber}</span>
            <span style={{ width: 28, color: '#6b7280' }}>{h.par}</span>
            <span style={{ width: 32, color: '#14532d' }}>{h.gross}</span>
            <span style={{ width: 30, color: '#a1791f' }}>{h.pts ?? '—'}</span>
            {trackStats && <>
              <span style={{ width: 30, color: '#6b7280' }}>{h.par === 3 ? '–' : h.fairwayHit === null ? '—' : h.fairwayHit ? '✓' : '✕'}</span>
              <span style={{ width: 30, color: '#6b7280' }}>{h.gir === null ? '—' : h.gir ? '✓' : '✕'}</span>
              <span style={{ width: 28, color: '#6b7280' }}>{h.putts ?? '—'}</span>
            </>}
          </div>
        ))}
      </div>
    </div>
  )
}
