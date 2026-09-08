'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import CourseLibrarySearch, { type LibraryCourseSelection } from '@/components/trips/wizard/CourseLibrarySearch'

/**
 * Separate Solo Event Play from Practice Round Mode (5 Sep) --
 * deliberately its own, single-screen page -- not the multi-step trip
 * wizard, and not merged into "Create Trip" as another Event Type
 * (which the brief explicitly warned against, since that would make
 * Practice behave like an Event internally). One form, one submit,
 * straight into scoring.
 *
 * Practice Round Course Library + profile handicap follow-up (8 Sep) --
 * traced why course selection was blank: this page was never wired to
 * the Course Library at all, using plain free-text course/tee inputs
 * instead of CourseLibrarySearch -- the exact same component Create
 * Event already uses, reused here verbatim rather than building a
 * second course-data source. handicap is fetched once on mount from
 * the new GET /api/practice/create endpoint (the same profiles.handicap
 * column and rounding the POST handler already used at creation time,
 * just now also surfaced to the player before they submit).
 */
export default function NewPracticeRoundPage() {
  const router = useRouter()
  const [courseName, setCourseName] = useState('')
  const [librarySelection, setLibrarySelection] = useState<LibraryCourseSelection | null>(null)
  const [holes, setHoles] = useState<9 | 18>(18)
  const [playDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [handicap, setHandicap] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/practice/create')
      .then(res => res.ok ? res.json() : null)
      .then(body => { if (!cancelled && body) setHandicap(body.handicap ?? null) })
      .catch(() => { /* handicap simply doesn't pre-populate — never blocks starting */ })
    return () => { cancelled = true }
  }, [])

  async function handleStart() {
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/practice/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseName: librarySelection ? librarySelection.courseLabel : courseName,
          teeName: librarySelection?.teeName ?? '',
          holes,
          playDate,
          libraryHoles: librarySelection?.holes,
        }),
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
          <CourseLibrarySearch
            initialCourseName={courseName}
            initialSelection={librarySelection}
            onSelectLibrary={(selection) => {
              setLibrarySelection(selection)
              // A library tee set carries its own real hole count —
              // reflects it here so the visible "9/18 holes" state (used
              // only for the course-less fallback path) never disagrees
              // with what was actually selected.
              if (selection) setHoles(selection.holes.length === 9 ? 9 : 18)
            }}
            onManualNameChange={(name) => { setCourseName(name); setLibrarySelection(null) }}
          />

          {/* Manual holes toggle — only meaningful once no library tee
              is selected; a selected tee's own hole count already
              determines this above. */}
          {!librarySelection && (
            <div style={{ marginTop: 14 }}>
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
          )}

          {/* Profile handicap pre-population — read-only display; the
              same value the POST handler already reads server-side at
              creation time, surfaced here so the player can see it's
              being used before they start, per the explicit
              acceptance criterion. Editing your handicap remains a
              Profile-page action, not duplicated here. */}
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #f3f4f1' }}>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#7a7260' }}>
              Playing handicap: <strong style={{ color: '#14532d' }}>{handicap ?? '—'}</strong>
              {handicap === null && ' (not set — update in Profile)'}
            </span>
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
