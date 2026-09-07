'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Separate Solo Event Play from Practice Round Mode (5 Sep) --
 * deliberately its own, single-screen page -- not the multi-step trip
 * wizard, and not merged into "Create Trip" as another Event Type
 * (which the brief explicitly warned against, since that would make
 * Practice behave like an Event internally). One form, one submit,
 * straight into scoring.
 */
export default function NewPracticeRoundPage() {
  const router = useRouter()
  const [courseName, setCourseName] = useState('')
  const [teeName, setTeeName] = useState('')
  const [holes, setHoles] = useState<9 | 18>(18)
  const [playDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleStart() {
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/practice/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseName, teeName, holes, playDate }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'Could not start your practice round.')
        setSubmitting(false)
        return
      }
      router.push(`/trips/${body.tripId}/rounds/${body.roundId}`)
    } catch {
      setError('Could not start your practice round. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#faf6ed', padding: '24px 16px' }}>
      <div style={{ maxWidth: 420, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 30, marginBottom: 6 }}>⛳</div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: '#14532d' }}>
            Practice Round
          </h1>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#7a7260', marginTop: 4 }}>
            Score for yourself. This won&apos;t appear on any Event leaderboard,
            count toward achievements, or affect your competitive history.
          </p>
        </div>

        <div style={{ background: '#fff', border: '1px solid #eceae3', borderRadius: 14, padding: 18, marginBottom: 16 }}>
          <label style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#14532d', marginBottom: 6 }}>
            Course (optional)
          </label>
          <input
            value={courseName} onChange={e => setCourseName(e.target.value)}
            placeholder="e.g. Sandhurst North"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #d9c9a3', fontFamily: 'var(--font-body)', fontSize: 14, marginBottom: 14 }}
          />

          <label style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#14532d', marginBottom: 6 }}>
            Tees (optional)
          </label>
          <input
            value={teeName} onChange={e => setTeeName(e.target.value)}
            placeholder="e.g. Blue"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #d9c9a3', fontFamily: 'var(--font-body)', fontSize: 14, marginBottom: 14 }}
          />

          <label style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#14532d', marginBottom: 6 }}>
            Holes
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[9, 18].map(h => (
              <button
                key={h}
                onClick={() => setHoles(h as 9 | 18)}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 8, cursor: 'pointer',
                  background: holes === h ? '#14532d' : '#fff',
                  color: holes === h ? '#fff' : '#14532d',
                  border: holes === h ? 'none' : '1.5px solid #d9c9a3',
                  fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14,
                }}
              >
                {h} holes
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#dc2626' }}>
            {error}
          </div>
        )}

        <button
          onClick={handleStart}
          disabled={submitting}
          style={{
            width: '100%', padding: 14, borderRadius: 12, border: 'none',
            background: submitting ? '#9ca3af' : '#14532d', color: '#fff',
            fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 15,
            cursor: submitting ? 'default' : 'pointer',
          }}
        >
          {submitting ? 'Starting…' : 'Start Practice Round →'}
        </button>
      </div>
    </div>
  )
}
