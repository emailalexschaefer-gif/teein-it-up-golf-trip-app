'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'

interface AdminCourse {
  id: string; club_name: string; course_name: string; suburb: string | null; state: string | null
  country: string; is_active: boolean; source: string | null; source_url: string | null
  verified_at: string | null; updated_at: string
}

export default function CourseLibraryAdminClient() {
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)

  const { data, isLoading } = useQuery<{ courses: AdminCourse[] }>({
    queryKey: ['admin-courses'],
    queryFn: async () => {
      const res = await fetch('/api/admin/courses')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })

  return (
    <div style={{ minHeight: '100vh', background: '#faf9f6', padding: '16px 16px 90px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Link href="/dashboard" style={{ color: '#9ca3af', fontSize: 18, textDecoration: 'none' }}>←</Link>
        <span style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 18, fontWeight: 800 }}>Course Library Admin</span>
      </div>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af', marginBottom: 16 }}>
        Shared library, editable by admins only. Changes here never alter a round that has already been configured.
      </p>

      <button
        onClick={() => setShowAdd(s => !s)}
        style={{
          width: '100%', padding: '11px 0', borderRadius: 10, marginBottom: 12,
          background: '#ffffff', border: '1.5px dashed #c9a84c', color: '#7a5c00',
          fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: 'pointer',
        }}
      >
        {showAdd ? '✕ Cancel' : '+ Add Course'}
      </button>

      {showAdd && (
        <AddCourseForm onCreated={() => { setShowAdd(false); queryClient.invalidateQueries({ queryKey: ['admin-courses'] }) }} />
      )}

      {isLoading ? (
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#9ca3af', textAlign: 'center', marginTop: 24 }}>Loading…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(data?.courses ?? []).map(course => (
            <Link
              key={course.id} href={`/admin/courses/${course.id}`}
              style={{
                display: 'block', background: '#ffffff', borderRadius: 12, border: '1px solid #eceae3',
                padding: '12px 14px', textDecoration: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, color: '#14532d' }}>
                    {course.club_name} — {course.course_name}
                  </div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af', marginTop: 2 }}>
                    {[course.suburb, course.state].filter(Boolean).join(', ') || 'Location not set'}
                  </div>
                </div>
                <span style={{
                  fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, borderRadius: 10, padding: '3px 9px', flexShrink: 0,
                  background: course.is_active ? '#f0fdf4' : '#fef9ec',
                  color: course.is_active ? '#16a34a' : '#a1791f',
                  border: `1px solid ${course.is_active ? '#bbf7d0' : '#e8c96a'}`,
                }}>
                  {course.is_active ? 'Published' : 'Draft'}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function AddCourseForm({ onCreated }: { onCreated: () => void }) {
  const [clubName, setClubName] = useState('')
  const [courseName, setCourseName] = useState('')
  const [suburb, setSuburb] = useState('')
  const [state, setState] = useState('')
  const [source, setSource] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!clubName.trim() || !courseName.trim()) { setError('Club name and course name are required.'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/admin/courses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ club_name: clubName, course_name: courseName, suburb: suburb || null, state: state || null, source: source || null }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error ?? 'Could not create course.'); return }
      onCreated()
    } catch {
      setError('Could not create course. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const inputStyle: React.CSSProperties = { width: '100%', border: '1.5px solid #d1d5db', borderRadius: 8, padding: '8px 10px', fontFamily: 'var(--font-body)', fontSize: 13, marginBottom: 8 }

  return (
    <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #eceae3', padding: 14, marginBottom: 12 }}>
      <input style={inputStyle} placeholder="Club name (e.g. Sandhurst Club)" value={clubName} onChange={e => setClubName(e.target.value)} />
      <input style={inputStyle} placeholder="Course name (e.g. Champions Course)" value={courseName} onChange={e => setCourseName(e.target.value)} />
      <input style={inputStyle} placeholder="Suburb" value={suburb} onChange={e => setSuburb(e.target.value)} />
      <input style={inputStyle} placeholder="State" value={state} onChange={e => setState(e.target.value)} />
      <input style={{ ...inputStyle, marginBottom: 10 }} placeholder="Source / provenance (optional)" value={source} onChange={e => setSource(e.target.value)} />
      {error && <p style={{ color: '#dc2626', fontSize: 11.5, marginBottom: 8, fontFamily: 'var(--font-body)' }}>{error}</p>}
      <button
        onClick={submit} disabled={saving}
        style={{ width: '100%', padding: '10px 0', borderRadius: 8, background: '#14532d', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}
      >
        {saving ? 'Creating…' : 'Create Course (draft)'}
      </button>
    </div>
  )
}
