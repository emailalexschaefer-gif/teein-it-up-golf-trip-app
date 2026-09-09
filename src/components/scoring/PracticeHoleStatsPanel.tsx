'use client'

import { useEffect, useState } from 'react'

interface HoleStat { hole_number: number; fairway_hit: boolean | null; gir: boolean | null; putts: number | null }

/**
 * Practice V2 (8 Sep), item 3 -- per-hole stat capture. Mounted
 * directly beneath the normal scoring controls, only when
 * isPractice && trackStats. Fairway Hit is never shown on Par 3, per
 * the explicit GIR/Fairway definitions in the brief. Autosaves on each
 * tap via /practice-stats -- never blocks Next Hole (there is no
 * "submit" button here at all; each answer persists independently the
 * moment it's tapped), and survives refresh/re-entry by fetching the
 * existing stored value on mount and whenever the hole changes.
 */
export default function PracticeHoleStatsPanel({
  tripId, roundId, holeNumber, par,
}: { tripId: string; roundId: string; holeNumber: number; par: number }) {
  const [fairwayHit, setFairwayHit] = useState<boolean | null>(null)
  const [gir, setGir] = useState<boolean | null>(null)
  const [putts, setPutts] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    fetch(`/api/trips/${tripId}/rounds/${roundId}/practice-stats`)
      .then(res => res.ok ? res.json() : { stats: [] })
      .then((body: { stats: HoleStat[] }) => {
        if (cancelled) return
        const existing = body.stats.find(s => s.hole_number === holeNumber)
        setFairwayHit(existing?.fairway_hit ?? null)
        setGir(existing?.gir ?? null)
        setPutts(existing?.putts ?? null)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
    return () => { cancelled = true }
  }, [tripId, roundId, holeNumber])

  async function save(next: { fairwayHit?: boolean | null; gir?: boolean | null; putts?: number | null }) {
    const merged = {
      fairwayHit: next.fairwayHit !== undefined ? next.fairwayHit : fairwayHit,
      gir: next.gir !== undefined ? next.gir : gir,
      putts: next.putts !== undefined ? next.putts : putts,
    }
    if (next.fairwayHit !== undefined) setFairwayHit(next.fairwayHit)
    if (next.gir !== undefined) setGir(next.gir)
    if (next.putts !== undefined) setPutts(next.putts)
    try {
      await fetch(`/api/trips/${tripId}/rounds/${roundId}/practice-stats`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holeNumber, ...merged }),
      })
    } catch { /* stat entry is optional — a failed autosave never blocks scoring */ }
  }

  const yesNoButton = (label: string, value: boolean | null, onSet: (v: boolean) => void) => (
    <div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: '#7a7260', marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        {[true, false].map(v => (
          <button
            key={String(v)}
            onClick={() => onSet(v)}
            style={{
              flex: 1, padding: '7px 0', borderRadius: 7, cursor: 'pointer',
              background: value === v ? '#14532d' : '#fff',
              color: value === v ? '#fff' : '#14532d',
              border: value === v ? 'none' : '1.5px solid #d9c9a3',
              fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5,
            }}
          >
            {v ? 'Yes' : 'No'}
          </button>
        ))}
      </div>
    </div>
  )

  if (!loaded) return null

  return (
    <div style={{ marginTop: 10, padding: '12px 14px', background: '#f7f6f1', border: '1px solid #eceae3', borderRadius: 12 }}>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#a1791f', letterSpacing: 0.5, marginBottom: 10 }}>
        PRACTICE STATS (OPTIONAL)
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: par === 3 ? '1fr' : '1fr 1fr', gap: 10, marginBottom: 10 }}>
        {par !== 3 && yesNoButton('FAIRWAY HIT?', fairwayHit, v => save({ fairwayHit: v }))}
        {yesNoButton('GREEN IN REGULATION?', gir, v => save({ gir: v }))}
      </div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: '#7a7260', marginBottom: 4 }}>PUTTS</div>
      <div style={{ display: 'flex', gap: 5 }}>
        {[0, 1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            onClick={() => save({ putts: n })}
            style={{
              flex: 1, padding: '7px 0', borderRadius: 7, cursor: 'pointer',
              background: putts === n ? '#14532d' : '#fff',
              color: putts === n ? '#fff' : '#14532d',
              border: putts === n ? 'none' : '1.5px solid #d9c9a3',
              fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5,
            }}
          >
            {n === 5 ? '5+' : n}
          </button>
        ))}
      </div>
    </div>
  )
}
