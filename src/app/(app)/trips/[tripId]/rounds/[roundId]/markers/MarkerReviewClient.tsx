'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'

interface Player { playerId: string; fullName: string }
interface GroupInfo { groupId: string; groupName: string; players: Player[] }
interface Assignment { player_id: string; marker_player_id: string }

export default function MarkerReviewClient({ tripId, roundId }: { tripId: string; roundId: string }) {
  const [groups, setGroups] = useState<GroupInfo[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/markers`)
      if (res.ok) {
        const data = await res.json()
        setGroups(data.groups ?? [])
        setAssignments(data.assignments ?? [])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [tripId, roundId]) // eslint-disable-line react-hooks/exhaustive-deps

  function markerFor(playerId: string): string | null {
    return assignments.find(a => a.player_id === playerId)?.marker_player_id ?? null
  }

  async function regenerate(groupId: string) {
    setSaving(groupId); setError(null)
    try {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/markers`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Could not regenerate assignments.')
      } else {
        await load()
      }
    } finally {
      setSaving(null)
    }
  }

  async function setMarker(group: GroupInfo, playerId: string, markerPlayerId: string) {
    setSaving(group.groupId); setError(null)
    const nextForGroup = group.players.map(p => ({
      playerId: p.playerId,
      markerPlayerId: p.playerId === playerId ? markerPlayerId : (markerFor(p.playerId) ?? p.playerId),
    }))
    try {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/markers`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: group.groupId, assignments: nextForGroup }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Every player must have exactly one marker — check for a duplicate or missing assignment.')
      } else {
        await load()
      }
    } finally {
      setSaving(null)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0e1912', padding: '20px 16px 60px' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: 'var(--font-display)', color: '#e8c96a', fontSize: 20, fontWeight: 800 }}>Marker Assignments</div>
        <div style={{ fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.5)', fontSize: 12, marginTop: 4 }}>
          Each player records their own score and one nominated marker&apos;s score. Review and adjust pairings below before the round begins.
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.4)', borderRadius: 10, padding: '10px 12px', marginBottom: 14, fontFamily: 'var(--font-body)', fontSize: 12, color: '#f87171' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.5)', fontSize: 13 }}>Loading…</div>
      ) : groups.length === 0 ? (
        <div style={{ fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.5)', fontSize: 13 }}>
          No playing groups with scorecards found for this round yet.
        </div>
      ) : (
        groups.map(group => (
          <div key={group.groupId} style={{ background: '#161f19', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontFamily: 'var(--font-body)', color: '#fff', fontWeight: 700, fontSize: 14 }}>{group.groupName}</div>
              <button
                onClick={() => regenerate(group.groupId)}
                disabled={saving === group.groupId}
                style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#e8c96a', background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.4)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer' }}
              >
                {saving === group.groupId ? 'Saving…' : 'Auto-assign'}
              </button>
            </div>

            {group.players.map(p => (
              <div key={p.playerId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 13, color: '#fff' }}>{p.fullName}</div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>marked by</div>
                <select
                  value={markerFor(p.playerId) ?? ''}
                  onChange={e => setMarker(group, p.playerId, e.target.value)}
                  disabled={saving === group.groupId}
                  style={{ background: '#0e1912', color: '#fff', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '5px 8px', fontFamily: 'var(--font-body)', fontSize: 12 }}
                >
                  <option value="" disabled>— choose —</option>
                  {group.players.filter(m => m.playerId !== p.playerId).map(m => (
                    <option key={m.playerId} value={m.playerId}>{m.fullName}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        ))
      )}

      <Link href={`/trips/${tripId}/rounds/${roundId}`} style={{ display: 'block', textAlign: 'center', marginTop: 10, fontFamily: 'var(--font-body)', fontSize: 12, color: 'rgba(245,230,184,0.4)', textDecoration: 'none' }}>
        ← Back to scoring
      </Link>
    </div>
  )
}
