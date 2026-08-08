'use client'

import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

export default function TripInformationCard({ tripId, isOrganiser }: { tripId: string; isOrganiser: boolean }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedFlash, setSavedFlash] = useState(false)

  const { data, isLoading } = useQuery<{ trip_information: string | null }>({
    queryKey: ['trip-information', tripId],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/information`)
      if (!res.ok) throw new Error('Could not load Trip Information.')
      return res.json()
    },
  })

  const info = data?.trip_information ?? null

  function startEdit() {
    setDraft(info ?? '')
    setError('')
    setEditing(true)
  }

  function cancelEdit() {
    // Cancel is a pure client-side no-op — no request sent, so the saved
    // version (whatever the query cache already holds) is left exactly
    // as it was, per the explicit "Cancel leaves the saved version
    // unchanged" requirement.
    setEditing(false)
    setError('')
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/trips/${tripId}/information`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trip_information: draft }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || "Couldn't save. Please try again.")
        return
      }
      queryClient.setQueryData(['trip-information', tripId], { trip_information: json.trip_information })
      setEditing(false)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2500)
    } catch {
      setError('Network error — please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) return null

  return (
    <div className="card p-4 space-y-3">
      <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <p className="s-label">Trip information</p>
        {isOrganiser && !editing && (
          <button
            onClick={startEdit}
            style={{
              fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#1a4731',
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            }}
          >
            {info ? 'Edit Trip Information' : '+ Add Trip Information'}
          </button>
        )}
      </div>

      {savedFlash && (
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#16a34a', fontWeight: 700 }}>
          ✓ Trip Information saved
        </p>
      )}

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDraft(e.target.value)}
            placeholder="Paste your itinerary, accommodation details, tee times, or any other trip information here…"
            rows={10}
            maxLength={20000}
            style={{
              width: '100%', border: '1.5px solid #d9c9a3', borderRadius: 10, padding: 12,
              fontFamily: 'var(--font-body)', fontSize: 13.5, lineHeight: 1.5, color: '#1a1a16',
              resize: 'vertical', minHeight: 200,
            }}
          />
          {error && (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#dc2626' }}>{error}</p>
          )}
          <div className="flex" style={{ gap: 8 }}>
            <button
              onClick={save}
              disabled={saving}
              style={{
                flex: 1, padding: '10px 14px', borderRadius: 10, border: 'none',
                background: 'linear-gradient(135deg, #2d7a52, #1a4731)', cursor: saving ? 'default' : 'pointer',
                fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#ffffff',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Save Trip Information'}
            </button>
            <button
              onClick={cancelEdit}
              disabled={saving}
              style={{
                padding: '10px 14px', borderRadius: 10, border: '1.5px solid #d9c9a3',
                background: '#fff', cursor: 'pointer',
                fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#1a1a16',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : info ? (
        // white-space:pre-wrap is the actual mechanism preserving
        // paragraphs, blank lines, and any bullet-point/heading text the
        // organiser typed — no markdown parsing, matching the explicit
        // "one plain text field" V1 scope, while still rendering exactly
        // as pasted rather than collapsing whitespace like normal HTML
        // text would.
        <p style={{
          fontFamily: 'var(--font-body)', fontSize: 13.5, lineHeight: 1.6, color: '#1a1a16',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
        }}>
          {info}
        </p>
      ) : (
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#9ca3af' }}>
          {isOrganiser
            ? 'Add all the important details for your trip in one place.'
            : 'Trip information has not been added yet.'}
        </p>
      )}
    </div>
  )
}
