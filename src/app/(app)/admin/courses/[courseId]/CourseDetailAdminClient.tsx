'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'

interface Course {
  id: string; club_name: string; course_name: string; suburb: string | null; state: string | null
  country: string; is_active: boolean; source: string | null; source_url: string | null; verified_at: string | null
}
interface Hole { hole_number: number; par: number; stroke_index: number | null; distance: number | null }
interface TeeSet {
  id: string; name: string; colour: string | null; gender: string | null
  par: number | null; total_distance: number | null; course_rating: number | null; slope_rating: number | null
  is_active: boolean; holes: Hole[]
}

export default function CourseDetailAdminClient({ courseId }: { courseId: string }) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery<{ course: Course; teeSets: TeeSet[] }>({
    queryKey: ['admin-course', courseId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/courses/${courseId}`)
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })

  function refresh() { queryClient.invalidateQueries({ queryKey: ['admin-course', courseId] }) }

  if (isLoading || !data) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontFamily: 'var(--font-body)', fontSize: 13 }}>Loading…</div>
  }

  return (
    <div style={{ minHeight: '100vh', background: '#faf9f6', padding: '16px 16px 90px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Link href="/admin/courses" style={{ color: '#9ca3af', fontSize: 18, textDecoration: 'none' }}>←</Link>
        <span style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 16, fontWeight: 800 }}>
          {data.course.club_name} — {data.course.course_name}
        </span>
      </div>

      <CourseInfoCard course={data.course} onSaved={refresh} />

      <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#a1791f', textTransform: 'uppercase', letterSpacing: 0.5, margin: '18px 0 8px' }}>
        Tee Sets
      </div>
      {data.teeSets.map(tee => <TeeSetCard key={tee.id} tee={tee} onSaved={refresh} />)}
      <AddTeeSetForm courseId={courseId} onCreated={refresh} />
    </div>
  )
}

function CourseInfoCard({ course, onSaved }: { course: Course; onSaved: () => void }) {
  const [clubName, setClubName] = useState(course.club_name)
  const [courseName, setCourseName] = useState(course.course_name)
  const [suburb, setSuburb] = useState(course.suburb ?? '')
  const [state, setState] = useState(course.state ?? '')
  const [source, setSource] = useState(course.source ?? '')
  const [sourceUrl, setSourceUrl] = useState(course.source_url ?? '')
  const [saving, setSaving] = useState(false)

  async function save(extra?: Record<string, unknown>) {
    setSaving(true)
    try {
      await fetch(`/api/admin/courses/${course.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          club_name: clubName, course_name: courseName, suburb: suburb || null, state: state || null,
          source: source || null, source_url: sourceUrl || null,
          ...extra,
        }),
      })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  const inputStyle: React.CSSProperties = { width: '100%', border: '1.5px solid #d1d5db', borderRadius: 8, padding: '8px 10px', fontFamily: 'var(--font-body)', fontSize: 13, marginBottom: 8 }

  return (
    <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #eceae3', padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' }}>Course Info</span>
        <button
          onClick={() => save({ is_active: !course.is_active })} disabled={saving}
          style={{
            fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, borderRadius: 8, padding: '5px 10px', cursor: 'pointer',
            background: course.is_active ? '#fef2f2' : '#f0fdf4', color: course.is_active ? '#dc2626' : '#16a34a',
            border: `1px solid ${course.is_active ? '#fecaca' : '#bbf7d0'}`,
          }}
        >
          {course.is_active ? 'Deactivate' : 'Publish'}
        </button>
      </div>
      <input style={inputStyle} placeholder="Club name" value={clubName} onChange={e => setClubName(e.target.value)} />
      <input style={inputStyle} placeholder="Course name" value={courseName} onChange={e => setCourseName(e.target.value)} />
      <div style={{ display: 'flex', gap: 8 }}>
        <input style={inputStyle} placeholder="Suburb" value={suburb} onChange={e => setSuburb(e.target.value)} />
        <input style={inputStyle} placeholder="State" value={state} onChange={e => setState(e.target.value)} />
      </div>
      <input style={inputStyle} placeholder="Source / provenance" value={source} onChange={e => setSource(e.target.value)} />
      <input style={{ ...inputStyle, marginBottom: 10 }} placeholder="Source URL" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} />
      <button onClick={() => save()} disabled={saving} style={{ width: '100%', padding: '9px 0', borderRadius: 8, background: '#14532d', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
        {saving ? 'Saving…' : 'Save Course Info'}
      </button>
    </div>
  )
}

function TeeSetCard({ tee, onSaved }: { tee: TeeSet; onSaved: () => void }) {
  const [name, setName] = useState(tee.name)
  const [colour, setColour] = useState(tee.colour ?? '')
  const [par, setPar] = useState(tee.par?.toString() ?? '')
  const [totalDistance, setTotalDistance] = useState(tee.total_distance?.toString() ?? '')
  const [courseRating, setCourseRating] = useState(tee.course_rating?.toString() ?? '')
  const [slopeRating, setSlopeRating] = useState(tee.slope_rating?.toString() ?? '')
  const [saving, setSaving] = useState(false)
  const [holesOpen, setHolesOpen] = useState(false)

  async function save(extra?: Record<string, unknown>) {
    setSaving(true)
    try {
      await fetch(`/api/admin/tee-sets/${tee.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, colour: colour || null,
          par: par ? Number(par) : null, total_distance: totalDistance ? Number(totalDistance) : null,
          course_rating: courseRating ? Number(courseRating) : null, slope_rating: slopeRating ? Number(slopeRating) : null,
          ...extra,
        }),
      })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  const inputStyle: React.CSSProperties = { border: '1.5px solid #d1d5db', borderRadius: 8, padding: '7px 9px', fontFamily: 'var(--font-body)', fontSize: 12.5 }

  return (
    <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #eceae3', padding: 14, marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, color: '#14532d' }}>{tee.name}</span>
        <button
          onClick={() => save({ is_active: !tee.is_active })} disabled={saving}
          style={{
            fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, borderRadius: 8, padding: '4px 9px', cursor: 'pointer',
            background: tee.is_active ? '#fef2f2' : '#f0fdf4', color: tee.is_active ? '#dc2626' : '#16a34a',
            border: `1px solid ${tee.is_active ? '#fecaca' : '#bbf7d0'}`,
          }}
        >
          {tee.is_active ? 'Deactivate' : 'Publish'}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        <input style={inputStyle} placeholder="Tee name" value={name} onChange={e => setName(e.target.value)} />
        <input style={inputStyle} placeholder="Colour (e.g. #ffffff or white)" value={colour} onChange={e => setColour(e.target.value)} />
        <input style={inputStyle} type="number" placeholder="Par" value={par} onChange={e => setPar(e.target.value)} />
        <input style={inputStyle} type="number" placeholder="Total distance (m)" value={totalDistance} onChange={e => setTotalDistance(e.target.value)} />
        <input style={inputStyle} type="number" step="0.1" placeholder="Scratch / Course Rating" value={courseRating} onChange={e => setCourseRating(e.target.value)} />
        <input style={inputStyle} type="number" placeholder="Slope Rating" value={slopeRating} onChange={e => setSlopeRating(e.target.value)} />
      </div>
      <button onClick={() => save()} disabled={saving} style={{ width: '100%', padding: '8px 0', borderRadius: 8, background: '#14532d', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12, cursor: 'pointer', marginBottom: 8 }}>
        {saving ? 'Saving…' : 'Save Tee Set'}
      </button>
      <button onClick={() => setHolesOpen(o => !o)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#a1791f' }}>
        {holesOpen ? '▲ Hide holes' : `▼ Holes (${tee.holes.filter(h => h.stroke_index !== null).length}/${tee.holes.length} with stroke index)`}
      </button>
      {holesOpen && <HoleEditor teeSetId={tee.id} holes={tee.holes} onSaved={onSaved} />}
    </div>
  )
}

function HoleEditor({ teeSetId, holes, onSaved }: { teeSetId: string; holes: Hole[]; onSaved: () => void }) {
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #f3f4f1' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '30px 1fr 1fr 1fr 50px', gap: 6, fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, color: '#9ca3af', marginBottom: 4, textTransform: 'uppercase' }}>
        <span>H</span><span>Par</span><span>SI</span><span>Dist</span><span></span>
      </div>
      {holes.sort((a, b) => a.hole_number - b.hole_number).map(hole => (
        <HoleRow key={hole.hole_number} teeSetId={teeSetId} hole={hole} onSaved={onSaved} />
      ))}
    </div>
  )
}

function HoleRow({ teeSetId, hole, onSaved }: { teeSetId: string; hole: Hole; onSaved: () => void }) {
  const [par, setPar] = useState(hole.par.toString())
  const [si, setSi] = useState(hole.stroke_index?.toString() ?? '')
  const [distance, setDistance] = useState(hole.distance?.toString() ?? '')
  const [saving, setSaving] = useState(false)
  const cellStyle: React.CSSProperties = { border: '1px solid #e5e2d9', borderRadius: 6, padding: '4px 6px', fontFamily: 'var(--font-body)', fontSize: 12, width: '100%' }

  async function save() {
    setSaving(true)
    try {
      await fetch(`/api/admin/tee-sets/${teeSetId}/holes/${hole.hole_number}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ par: Number(par), stroke_index: si ? Number(si) : null, distance: distance ? Number(distance) : null }),
      })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '30px 1fr 1fr 1fr 50px', gap: 6, alignItems: 'center', marginBottom: 4 }}>
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#14532d' }}>{hole.hole_number}</span>
      <input style={cellStyle} type="number" value={par} onChange={e => setPar(e.target.value)} />
      <input style={cellStyle} type="number" value={si} onChange={e => setSi(e.target.value)} placeholder="—" />
      <input style={cellStyle} type="number" value={distance} onChange={e => setDistance(e.target.value)} placeholder="—" />
      <button onClick={save} disabled={saving} style={{ fontSize: 10.5, fontWeight: 700, color: '#14532d', background: '#f3f4f1', border: 'none', borderRadius: 6, padding: '5px 0', cursor: 'pointer' }}>
        {saving ? '…' : 'Save'}
      </button>
    </div>
  )
}

function AddTeeSetForm({ courseId, onCreated }: { courseId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [colour, setColour] = useState('')
  const [holeCount, setHoleCount] = useState(18)
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!name.trim()) return
    setSaving(true)
    try {
      await fetch(`/api/admin/courses/${courseId}/tee-sets`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, colour: colour || null, holeCount }),
      })
      setName(''); setColour(''); setOpen(false)
      onCreated()
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ width: '100%', padding: '11px 0', borderRadius: 10, background: '#ffffff', border: '1.5px dashed #c9a84c', color: '#7a5c00', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
        + Add Tee Set
      </button>
    )
  }

  const inputStyle: React.CSSProperties = { width: '100%', border: '1.5px solid #d1d5db', borderRadius: 8, padding: '8px 10px', fontFamily: 'var(--font-body)', fontSize: 13, marginBottom: 8 }
  return (
    <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #eceae3', padding: 14 }}>
      <input style={inputStyle} placeholder="Tee name (e.g. White)" value={name} onChange={e => setName(e.target.value)} />
      <input style={inputStyle} placeholder="Colour (optional)" value={colour} onChange={e => setColour(e.target.value)} />
      <select style={{ ...inputStyle, marginBottom: 10 }} value={holeCount} onChange={e => setHoleCount(Number(e.target.value))}>
        <option value={18}>18 holes</option>
        <option value={9}>9 holes</option>
      </select>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => setOpen(false)} style={{ flex: 1, padding: '9px 0', borderRadius: 8, background: '#ffffff', border: '1px solid #d1d5db', color: '#374151', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>Cancel</button>
        <button onClick={submit} disabled={saving} style={{ flex: 1, padding: '9px 0', borderRadius: 8, background: '#14532d', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
          {saving ? '…' : 'Create'}
        </button>
      </div>
    </div>
  )
}
