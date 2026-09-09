'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

interface SummaryResponse {
  trackStats: boolean
  totalHoles: number
  courseName: string | null
  teeName: string | null
  playDate: string
  startingHoleNumber: number
  summary: {
    holesCompleted: number; grossTotal: number; stablefordTotal: number
    fairwaysAnswered: number; fairwaysHit: number; fairwayPct: number | null
    girAnswered: number; girHit: number; girPct: number | null
    puttsAnswered: number; totalPutts: number; puttsPerHole: number | null
  }
}

/**
 * Practice V2 (8 Sep), item 7 -- "Practice Round Summary." Reuses the
 * exact same /my-stats aggregation the live dashboard reads, so this
 * screen and My Stats can never disagree by construction -- neither
 * recomputes anything independently.
 *
 * Deliberately does NOT show: marker verification, reconciliation,
 * Makers & Breakers, Event Complete, Event winner, Side Game winners,
 * Event Story, or any organiser close workflow -- none of that is
 * fetched or referenced anywhere in this file at all, not merely
 * hidden behind a conditional.
 */
export default function PracticeSummaryPage() {
  const params = useParams<{ tripId: string; roundId: string }>()
  const router = useRouter()
  const [data, setData] = useState<SummaryResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/trips/${params.tripId}/rounds/${params.roundId}/my-stats`)
      .then(res => res.json())
      .then(body => { if (!cancelled) setData(body) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [params.tripId, params.roundId])

  if (!data) return <div style={{ padding: 20, textAlign: 'center', fontFamily: 'var(--font-body)', color: '#9ca3af' }}>Loading…</div>

  const { summary, trackStats, totalHoles, courseName, teeName, playDate, startingHoleNumber } = data
  const nineLabel = totalHoles === 9 ? (startingHoleNumber === 1 ? 'Front 9' : 'Back 9') : (startingHoleNumber === 1 ? 'Start 1st Tee' : 'Start 10th Tee')

  return (
    <div style={{ minHeight: '100vh', background: '#faf6ed', padding: '24px 16px' }}>
      <div style={{ maxWidth: 420, margin: '0 auto', textAlign: 'center' }}>
        <div style={{ fontSize: 34, marginBottom: 8 }}>⛳</div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: '#14532d', marginBottom: 4 }}>
          Practice Round Complete
        </h1>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#7a7260', marginBottom: 20 }}>
          {courseName ?? 'Practice Round'}{teeName ? ` · ${teeName}` : ''} · {new Date(playDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
          <br />{totalHoles} holes · {nineLabel}
        </p>

        <div style={{ background: '#fff', border: '1px solid #eceae3', borderRadius: 14, padding: 20, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 28, marginBottom: trackStats ? 18 : 0 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 800, color: '#14532d' }}>{summary.grossTotal}</div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, color: '#9ca3af' }}>GROSS</div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 800, color: '#a1791f' }}>{summary.stablefordTotal}</div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, color: '#9ca3af' }}>STABLEFORD</div>
            </div>
          </div>

          {trackStats && (
            <div style={{ borderTop: '1px solid #f3f4f1', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, color: '#a1791f', letterSpacing: 0.5 }}>FAIRWAYS</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: '#14532d' }}>
                  {summary.fairwaysAnswered > 0 ? `${summary.fairwaysHit}/${summary.fairwaysAnswered} · ${summary.fairwayPct}%` : 'Not recorded'}
                </div>
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, color: '#a1791f', letterSpacing: 0.5 }}>GREENS IN REGULATION</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: '#14532d' }}>
                  {summary.girAnswered > 0 ? `${summary.girHit}/${summary.girAnswered} · ${summary.girPct}%` : 'Not recorded'}
                </div>
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, color: '#a1791f', letterSpacing: 0.5 }}>PUTTING</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: '#14532d' }}>
                  {summary.puttsAnswered > 0 ? `${summary.totalPutts} total · ${summary.puttsPerHole?.toFixed(2)}/hole` : 'Not recorded'}
                </div>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => router.push('/dashboard')}
          style={{
            width: '100%', padding: 14, borderRadius: 12, border: 'none',
            background: '#14532d', color: '#fff',
            fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 15, cursor: 'pointer',
          }}
        >
          View in My Golf →
        </button>
      </div>
    </div>
  )
}
