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
 * course/tee selection reuses CourseLibrarySearch verbatim, not a
 * second course-data source.
 *
 * Consolidated field-test package (8 Sep), items 2+3 -- these two are
 * one fix, not two: the previous version derived `holes` FROM the
 * selected library tee's own hole count (selection.holes.length),
 * which is exactly the bug -- "an 18-hole Course Library course means
 * 18 holes are AVAILABLE, it does NOT mean the golfer has selected an
 * 18-hole Practice Round." That auto-derivation silently overwrote a
 * genuine 9-hole choice back to 18 the moment a course/tee was picked.
 * Fixed by making holes/nineSelection/startingHole entirely
 * independent, golfer-authoritative state -- never inferred from or
 * overwritten by which course/tee was selected. The library selection
 * now only supplies which par/SI/distance values exist for hole
 * numbers 1-18; which SUBSET of those (front 9 / back 9 / all 18) and
 * what order they're played in is decided here and only here, then
 * sliced from the library's own holes array by hole_number at submit
 * time -- not by trusting its length.
 */
type HolesChoice = 9 | 18
type NineSelection = 'front' | 'back'
type StartingHole = 1 | 10

export default function NewPracticeRoundPage() {
  const router = useRouter()
  const [courseName, setCourseName] = useState('')
  const [librarySelection, setLibrarySelection] = useState<LibraryCourseSelection | null>(null)
  const [holesChoice, setHolesChoice] = useState<HolesChoice | null>(null)
  const [nineSelection, setNineSelection] = useState<NineSelection | null>(null)
  const [startingHole, setStartingHole] = useState<StartingHole | null>(null)
  const [trackStats, setTrackStats] = useState<boolean | null>(null)
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

  const canStart = (holesChoice === 9 ? nineSelection !== null : holesChoice === 18 ? startingHole !== null : false) && trackStats !== null

  async function handleStart() {
    if (!canStart) return
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/practice/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseName: librarySelection ? librarySelection.courseLabel : courseName,
          teeName: librarySelection?.teeName ?? '',
          holes: holesChoice,
          nineSelection,
          startingHole,
          trackStats,
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
            onSelectLibrary={(selection) => { setLibrarySelection(selection) }}
            onManualNameChange={(name) => { setCourseName(name); setLibrarySelection(null) }}
          />

          {/* Step 1 — "How many holes?" Golfer-authoritative, never
              touched by course/tee selection above or below. */}
          <div style={{ marginTop: 14 }}>
            <label style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#14532d', marginBottom: 6 }}>
              How many holes?
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              {([9, 18] as const).map(h => (
                <button
                  key={h}
                  onClick={() => { setHolesChoice(h); setNineSelection(null); setStartingHole(null) }}
                  style={{
                    flex: 1, padding: '10px 0', borderRadius: 8, cursor: 'pointer',
                    background: holesChoice === h ? '#14532d' : '#fff',
                    color: holesChoice === h ? '#fff' : '#14532d',
                    border: holesChoice === h ? 'none' : '1.5px solid #d9c9a3',
                    fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14,
                  }}
                >
                  {h} Holes
                </button>
              ))}
            </div>
          </div>

          {/* Step 2a — 9 holes: which nine? */}
          {holesChoice === 9 && (
            <div style={{ marginTop: 14 }}>
              <label style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#14532d', marginBottom: 6 }}>
                Which nine?
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setNineSelection('front')}
                  style={{
                    flex: 1, padding: '10px 6px', borderRadius: 8, cursor: 'pointer', textAlign: 'center',
                    background: nineSelection === 'front' ? '#14532d' : '#fff',
                    color: nineSelection === 'front' ? '#fff' : '#14532d',
                    border: nineSelection === 'front' ? 'none' : '1.5px solid #d9c9a3',
                    fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14,
                  }}
                >
                  Front 9<div style={{ fontSize: 11, fontWeight: 500, opacity: 0.8 }}>Holes 1–9</div>
                </button>
                <button
                  onClick={() => setNineSelection('back')}
                  style={{
                    flex: 1, padding: '10px 6px', borderRadius: 8, cursor: 'pointer', textAlign: 'center',
                    background: nineSelection === 'back' ? '#14532d' : '#fff',
                    color: nineSelection === 'back' ? '#fff' : '#14532d',
                    border: nineSelection === 'back' ? 'none' : '1.5px solid #d9c9a3',
                    fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14,
                  }}
                >
                  Back 9<div style={{ fontSize: 11, fontWeight: 500, opacity: 0.8 }}>Holes 10–18</div>
                </button>
              </div>
            </div>
          )}

          {/* Step 2b — 18 holes: where are you starting? */}
          {holesChoice === 18 && (
            <div style={{ marginTop: 14 }}>
              <label style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#14532d', marginBottom: 6 }}>
                Where are you starting?
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setStartingHole(1)}
                  style={{
                    flex: 1, padding: '10px 0', borderRadius: 8, cursor: 'pointer',
                    background: startingHole === 1 ? '#14532d' : '#fff',
                    color: startingHole === 1 ? '#fff' : '#14532d',
                    border: startingHole === 1 ? 'none' : '1.5px solid #d9c9a3',
                    fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14,
                  }}
                >
                  1st Tee
                </button>
                <button
                  onClick={() => setStartingHole(10)}
                  style={{
                    flex: 1, padding: '10px 0', borderRadius: 8, cursor: 'pointer',
                    background: startingHole === 10 ? '#14532d' : '#fff',
                    color: startingHole === 10 ? '#fff' : '#14532d',
                    border: startingHole === 10 ? 'none' : '1.5px solid #d9c9a3',
                    fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14,
                  }}
                >
                  10th Tee
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — "Track Practice Stats?" Appears after
              hole/starting-tee selection is resolved, per the brief's
              explicit ordering. Persisted explicitly as
              rounds.track_practice_stats — never inferred later from
              whether any stat rows happen to exist. */}
          {((holesChoice === 9 && nineSelection !== null) || (holesChoice === 18 && startingHole !== null)) && (
            <div style={{ marginTop: 14 }}>
              <label style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#14532d', marginBottom: 4 }}>
                Track Practice Stats?
              </label>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#7a7260', marginBottom: 8 }}>
                Track fairways, greens in regulation and putting to see how your game improves over time.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setTrackStats(true)}
                  style={{
                    flex: 1, padding: '10px 0', borderRadius: 8, cursor: 'pointer',
                    background: trackStats === true ? '#14532d' : '#fff',
                    color: trackStats === true ? '#fff' : '#14532d',
                    border: trackStats === true ? 'none' : '1.5px solid #d9c9a3',
                    fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14,
                  }}
                >
                  Yes
                </button>
                <button
                  onClick={() => setTrackStats(false)}
                  style={{
                    flex: 1, padding: '10px 0', borderRadius: 8, cursor: 'pointer',
                    background: trackStats === false ? '#14532d' : '#fff',
                    color: trackStats === false ? '#fff' : '#14532d',
                    border: trackStats === false ? 'none' : '1.5px solid #d9c9a3',
                    fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14,
                  }}
                >
                  No
                </button>
              </div>
            </div>
          )}

          {/* Profile handicap pre-population — read-only display; the
              same value the POST handler already reads server-side at
              creation time. */}
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
          disabled={submitting || !canStart}
          style={{
            width: '100%', padding: 14, borderRadius: 12, border: 'none',
            background: (submitting || !canStart) ? '#9ca3af' : '#14532d', color: '#fff',
            fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 15,
            cursor: (submitting || !canStart) ? 'default' : 'pointer',
          }}
        >
          {submitting ? 'Starting…' : 'Start Practice Round →'}
        </button>
      </div>
    </div>
  )
}
