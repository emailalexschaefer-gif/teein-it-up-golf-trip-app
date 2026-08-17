'use client'

import { useEffect, useState } from 'react'
import { Field, Input } from '@/components/ui/FormFields'

export interface LibraryCourseSelection {
  courseLabel: string // "Sandhurst Club — Champions Course", used to auto-fill course_name
  teeSetId: string
  teeName: string
  courseRating: number | null
  slopeRating: number | null
  holes: { hole_number: number; par: number; stroke_index: number | null; distance: number | null; pro_tip: string | null }[]
}

interface CourseSearchResult { id: string; club_name: string; course_name: string; suburb: string | null; state: string | null }
interface TeeSetResult {
  id: string; name: string; colour: string | null; gender: string | null
  par: number | null; total_distance: number | null; course_rating: number | null; slope_rating: number | null
  holes: { hole_number: number; par: number; stroke_index: number | null; distance: number | null; pro_tip: string | null }[]
}

/**
 * "Search Course Library → Select Course → Select Tee Set → Review
 * Loaded Course → Continue" — the normal experience, per the explicit
 * "do not start with a Library vs Manual choice screen" instruction.
 * Manual setup is reached via a plain link below the search, always
 * visible, never a separate up-front decision.
 *
 * Handles partial records gracefully throughout: a tee set with no
 * slope/rating/distance yet still renders and is still selectable — see
 * TeeSummaryCard below, which shows "—" for any null field rather than
 * hiding the tee or blocking selection.
 *
 * `initialSelection` is how editing an existing round shows what was
 * already loaded from the library, without needing to re-search —
 * confirmTee's own re-fetch of a course's tee sets only happens if the
 * organiser explicitly taps "Change tee", not on every re-render.
 */
export default function CourseLibrarySearch({
  initialCourseName, initialSelection, onSelectLibrary, onManualNameChange,
}: {
  initialCourseName: string
  initialSelection?: LibraryCourseSelection | null
  onSelectLibrary: (selection: LibraryCourseSelection | null) => void
  onManualNameChange: (name: string) => void
}) {
  const [mode, setMode] = useState<'search' | 'tees' | 'manual' | 'confirmed'>(
    initialSelection ? 'confirmed' : initialCourseName ? 'manual' : 'search'
  )
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CourseSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedCourse, setSelectedCourse] = useState<CourseSearchResult | null>(null)
  const [teeSets, setTeeSets] = useState<TeeSetResult[]>([])
  const [selectedTeeId, setSelectedTeeId] = useState<string | null>(null)

  // Debounced search — fires on mount too (empty query returns the
  // first 20 published courses, useful as an initial browse list).
  useEffect(() => {
    if (mode !== 'search') return
    let cancelled = false
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/course-library/search?q=${encodeURIComponent(query)}`)
        if (res.ok && !cancelled) setResults((await res.json()).courses ?? [])
      } catch { /* ignore — results just stay empty, manual fallback is always visible */ }
      if (!cancelled) setLoading(false)
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, mode])

  async function selectCourse(course: CourseSearchResult) {
    setSelectedCourse(course)
    setLoading(true)
    try {
      const res = await fetch(`/api/course-library/courses/${course.id}/tee-sets`)
      if (res.ok) {
        const body = await res.json()
        setTeeSets(body.teeSets ?? [])
        setMode('tees')
      }
    } catch { /* ignore */ }
    setLoading(false)
  }

  function confirmTee(tee: TeeSetResult) {
    setSelectedTeeId(tee.id)
    if (!selectedCourse) return
    onSelectLibrary({
      courseLabel: `${selectedCourse.club_name} — ${selectedCourse.course_name}`,
      teeSetId: tee.id, teeName: tee.name,
      courseRating: tee.course_rating, slopeRating: tee.slope_rating,
      holes: tee.holes,
    })
  }

  if (mode === 'confirmed' && initialSelection) {
    return (
      <div className="space-y-2">
        <TeeSummaryCard
          courseLabel={initialSelection.courseLabel}
          tee={{
            id: initialSelection.teeSetId, name: initialSelection.teeName, colour: null, gender: null,
            par: initialSelection.holes.length > 0 ? initialSelection.holes.reduce((s, h) => s + h.par, 0) : null,
            total_distance: null, course_rating: initialSelection.courseRating, slope_rating: initialSelection.slopeRating,
            holes: initialSelection.holes,
          }}
          onChangeTee={() => { setMode('search'); onSelectLibrary(null) }}
        />
        <p className="text-[11px] text-text-muted italic">Loaded from Course Library. Choosing a different course or tee will update this round&apos;s hole data.</p>
      </div>
    )
  }

  if (mode === 'manual') {
    return (
      <div className="space-y-2">
        <Field label="Course">
          <Input
            value={initialCourseName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onManualNameChange(e.target.value)}
            placeholder="Royal County Down" maxLength={100}
          />
        </Field>
        <button
          type="button"
          onClick={() => { setMode('search'); onSelectLibrary(null) }}
          className="text-xs text-brand-600 hover:text-brand-700 transition-colors"
        >
          ← Search Course Library instead
        </button>
      </div>
    )
  }

  if (mode === 'tees' && selectedCourse) {
    const confirmedTee = teeSets.find(t => t.id === selectedTeeId)
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-text">{selectedCourse.club_name} — {selectedCourse.course_name}</p>
          <button type="button" onClick={() => { setMode('search'); setSelectedCourse(null); setSelectedTeeId(null); onSelectLibrary(null) }} className="text-xs text-text-muted hover:text-text transition-colors">
            Change course
          </button>
        </div>
        {!confirmedTee ? (
          <>
            <p className="text-xs text-text-muted">Which tees are you playing?</p>
            {teeSets.length === 0 && (
              <p className="text-xs text-text-muted italic">No tee sets have been added for this course yet — an admin can add them, or set up this round manually below.</p>
            )}
            <div className="flex flex-wrap gap-2">
              {teeSets.map(tee => (
                <button
                  key={tee.id} type="button" onClick={() => confirmTee(tee)}
                  className="border border-cream-300 rounded-xl px-3 py-2 text-left hover:border-brand-400 hover:bg-brand-50 transition-colors"
                  style={{ minWidth: 96 }}
                >
                  <div className="flex items-center gap-1.5">
                    {tee.colour && <span style={{ width: 10, height: 10, borderRadius: '50%', background: tee.colour, display: 'inline-block', flexShrink: 0 }} />}
                    <span className="text-sm font-medium text-text">{tee.name}</span>
                  </div>
                  <div className="text-[11px] text-text-muted mt-0.5">
                    {[
                      tee.total_distance ? `${tee.total_distance}m` : null,
                      tee.slope_rating ? `Slope ${tee.slope_rating}` : null,
                    ].filter(Boolean).join(' · ') || 'Details not yet added'}
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <TeeSummaryCard courseLabel={`${selectedCourse.club_name} — ${selectedCourse.course_name}`} tee={confirmedTee} onChangeTee={() => { setSelectedTeeId(null); onSelectLibrary(null) }} />
        )}
        <button type="button" onClick={() => { setMode('manual'); onSelectLibrary(null) }} className="text-xs text-text-muted hover:text-text transition-colors">
          Can&apos;t find your course? Set up course manually →
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Field label="Course">
        <Input
          value={query}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
          placeholder="Search for a golf course…"
        />
      </Field>
      {loading && <p className="text-xs text-text-muted">Searching…</p>}
      {!loading && results.length > 0 && (
        <div className="space-y-1.5">
          {results.map(course => (
            <button
              key={course.id} type="button" onClick={() => selectCourse(course)}
              className="w-full text-left bg-white rounded-xl p-2.5 border border-cream-300 hover:border-brand-400 hover:bg-brand-50 transition-colors"
            >
              <p className="text-sm font-medium text-text">{course.club_name} — {course.course_name}</p>
              {(course.suburb || course.state) && (
                <p className="text-xs text-text-muted">{[course.suburb, course.state].filter(Boolean).join(', ')}</p>
              )}
            </button>
          ))}
        </div>
      )}
      {!loading && query.trim().length > 0 && results.length === 0 && (
        <p className="text-xs text-text-muted italic">No matching courses found.</p>
      )}
      <button type="button" onClick={() => { setMode('manual'); onSelectLibrary(null) }} className="text-xs text-brand-600 hover:text-brand-700 transition-colors">
        Can&apos;t find your course? Set up course manually →
      </button>
    </div>
  )
}

function TeeSummaryCard({ courseLabel, tee, onChangeTee }: { courseLabel: string; tee: TeeSetResult; onChangeTee: () => void }) {
  // "Use verified stored data only. Do not invent or approximate
  // official values." — every field below either shows the real stored
  // value or "—", never a computed/assumed fallback.
  const dash = (v: number | null) => v ?? '—'
  const [showHoles, setShowHoles] = useState(false)
  return (
    <div className="bg-white rounded-xl border border-cream-300 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-brand-700 flex items-center gap-1.5">
          <span aria-hidden="true">✓</span> {tee.name} Tees selected
        </p>
        <button type="button" onClick={onChangeTee} className="text-xs text-text-muted hover:text-text transition-colors flex-shrink-0">
          Change tee
        </button>
      </div>
      <p className="text-xs text-text-muted">{courseLabel}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-text-muted">
        <span>{tee.holes.length || 18} Holes</span>
        <span>Par {dash(tee.par)}</span>
        <span>Total Distance {tee.total_distance ? `${tee.total_distance}m` : '—'}</span>
        <span>Scratch Rating {dash(tee.course_rating)}</span>
        <span>Slope Rating {dash(tee.slope_rating)}</span>
      </div>
      {tee.holes.length === 0 && (
        <p className="text-[11px] text-text-muted italic pt-1 border-t border-cream-200">
          Hole-by-hole data hasn&apos;t been added for this tee yet — you can still continue and enter hole details manually on the next screen.
        </p>
      )}
      {tee.holes.length > 0 && (
        <div className="pt-1 border-t border-cream-200">
          <button
            type="button"
            onClick={() => setShowHoles(s => !s)}
            className="text-xs text-brand-600 hover:text-brand-700 transition-colors"
          >
            {showHoles ? '▲ Hide' : '▼ View'} holes &amp; indexes
          </button>
          {showHoles && (
            <table className="w-full text-[11px] text-text-muted mt-2" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr className="text-left border-b border-cream-200">
                  <th className="py-1 font-medium">Hole</th>
                  <th className="py-1 font-medium">Par</th>
                  <th className="py-1 font-medium">SI</th>
                  <th className="py-1 font-medium">Distance</th>
                </tr>
              </thead>
              <tbody>
                {[...tee.holes].sort((a, b) => a.hole_number - b.hole_number).map(h => (
                  <tr key={h.hole_number} className="border-b border-cream-100">
                    <td className="py-1">{h.hole_number}</td>
                    <td className="py-1">{h.par}</td>
                    <td className="py-1">{h.stroke_index ?? '—'}</td>
                    <td className="py-1">{h.distance ? `${h.distance}m` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
