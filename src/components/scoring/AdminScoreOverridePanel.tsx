'use client'

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'

/**
 * Priority 4 — Admin Score Override, wired into My HQ. Drill-down:
 * groups -> players -> a scorecard's own hole grid -> tap a hole to
 * override it. Deliberately does not build any new scoring path — every
 * value shown here comes straight from /admin-scores (a read of the
 * exact same score_entries the live scoring shells write to), and
 * saving calls the existing high-integrity /override endpoint (old
 * value, new value, reason, who, when — all recorded there, not here).
 * This component's only job is presentation and the two-step confirm
 * (show old vs proposed new value before saving), not scoring logic.
 */
interface HoleRow { holeNumber: number; par: number; grossScore: number | null; isNoReturn: boolean; stablefordPts: number | null; adminOverridden: boolean }
interface PlayerRow { scorecardId: string; playerId: string; playerName: string; groupId: string | null; groupName: string; holes: HoleRow[] }
interface GroupRow { groupId: string | null; groupName: string; players: PlayerRow[] }

export default function AdminScoreOverridePanel({ tripId, roundId }: { tripId: string; roundId: string }) {
  const [groups, setGroups] = useState<GroupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerRow | null>(null)
  const [editingHole, setEditingHole] = useState<HoleRow | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/admin-scores`)
      if (res.ok) setGroups((await res.json()).groups ?? [])
    } catch { /* panel simply shows nothing new until the next successful load */ }
    setLoading(false)
  }
  useEffect(() => { void load() }, [tripId, roundId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return null

  const selectedGroup = groups.find(g => (g.groupId ?? 'ungrouped') === selectedGroupId)

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        ⚙ Admin Score Override
      </div>

      {editingHole && selectedPlayer ? (
        <OverrideForm
          tripId={tripId} roundId={roundId} scorecardId={selectedPlayer.scorecardId}
          hole={editingHole} playerName={selectedPlayer.playerName}
          onCancel={() => setEditingHole(null)}
          onSaved={() => { setEditingHole(null); void load() }}
        />
      ) : selectedPlayer ? (
        <div>
          <button onClick={() => setSelectedPlayer(null)} style={backLinkStyle}>← {selectedPlayer.groupName}</button>
          <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, color: '#14532d', margin: '8px 0' }}>{selectedPlayer.playerName}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
            {selectedPlayer.holes.map(h => (
              <button
                key={h.holeNumber}
                onClick={() => setEditingHole(h)}
                style={{
                  padding: '8px 4px', borderRadius: 8, textAlign: 'center', cursor: 'pointer',
                  background: h.adminOverridden ? '#fdf3d9' : '#ffffff',
                  border: `1px solid ${h.adminOverridden ? '#e8c96a' : '#eceae3'}`,
                }}
              >
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 9.5, color: '#9ca3af', fontWeight: 700 }}>H{h.holeNumber}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 800, color: '#14532d' }}>
                  {h.isNoReturn ? 'NR' : h.grossScore ?? '—'}
                </div>
                {h.adminOverridden && <div style={{ fontSize: 8, color: '#a1791f', fontWeight: 700 }}>⚙ edited</div>}
              </button>
            ))}
          </div>
        </div>
      ) : selectedGroup ? (
        <div>
          <button onClick={() => setSelectedGroupId(null)} style={backLinkStyle}>← Groups</button>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {selectedGroup.players.map(p => (
              <button key={p.scorecardId} onClick={() => setSelectedPlayer(p)} style={rowButtonStyle}>{p.playerName}</button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {groups.length === 0 && (
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af' }}>No scorecards for this round yet.</div>
          )}
          {groups.map(g => (
            <button key={g.groupId ?? 'ungrouped'} onClick={() => setSelectedGroupId(g.groupId ?? 'ungrouped')} style={rowButtonStyle}>
              {g.groupName} <span style={{ color: '#9ca3af', fontWeight: 500 }}>({g.players.length})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function OverrideForm({ tripId, roundId, scorecardId, hole, playerName, onCancel, onSaved }: {
  tripId: string; roundId: string; scorecardId: string; hole: HoleRow; playerName: string
  onCancel: () => void; onSaved: () => void
}) {
  const [grossScore, setGrossScore] = useState(hole.grossScore !== null ? String(hole.grossScore) : '')
  const [isNoReturn, setIsNoReturn] = useState(hole.isNoReturn)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const proposedValue = isNoReturn ? 'No Return' : (grossScore || '—')
  const currentValue = hole.isNoReturn ? 'No Return' : (hole.grossScore ?? '—')

  async function handleSave() {
    if (!reason.trim()) { setError('A reason is required.'); return }
    if (!isNoReturn && (!grossScore || Number(grossScore) < 1 || Number(grossScore) > 20)) {
      setError('Enter a valid gross score between 1 and 20, or mark as no return.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/scorecards/${scorecardId}/override`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holeNumber: hole.holeNumber, grossScore: isNoReturn ? null : Number(grossScore), isNoReturn, reason: reason.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? "Couldn't save the override. Please try again.")
        setSaving(false)
        return
      }
      onSaved()
    } catch {
      setError("Couldn't save the override. Check your connection and try again.")
      setSaving(false)
    }
  }

  return (
    <div style={{ background: '#ffffff', border: '1.5px solid #d9c9a3', borderRadius: 12, padding: 14 }}>
      <button onClick={onCancel} style={backLinkStyle}>← Cancel</button>
      <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, color: '#14532d', margin: '8px 0 4px' }}>
        {playerName} — Hole {hole.holeNumber} (Par {hole.par})
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 10, fontFamily: 'var(--font-body)', fontSize: 12.5 }}>
        <div><span style={{ color: '#9ca3af' }}>Current: </span><strong style={{ color: '#14532d' }}>{currentValue}</strong></div>
        <div><span style={{ color: '#9ca3af' }}>New: </span><strong style={{ color: '#a1791f' }}>{proposedValue}</strong></div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#374151', marginBottom: 8 }}>
        <input type="checkbox" checked={isNoReturn} onChange={e => setIsNoReturn(e.target.checked)} />
        Mark as No Return
      </label>

      {!isNoReturn && (
        <input
          type="number" inputMode="numeric" min="1" max="20"
          value={grossScore} onChange={e => setGrossScore(e.target.value)}
          placeholder="Gross score"
          style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '9px 10px', fontFamily: 'var(--font-body)', fontSize: 14, marginBottom: 8 }}
        />
      )}

      <textarea
        value={reason} onChange={e => setReason(e.target.value)}
        placeholder="Reason for this override (required) — e.g. lost phone, dispute resolved, incorrect entry corrected"
        rows={2}
        style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: 8, fontFamily: 'var(--font-body)', fontSize: 13, resize: 'vertical', marginBottom: 10 }}
      />

      {error && <p style={{ color: '#dc2626', fontSize: 11.5, marginBottom: 8, fontFamily: 'var(--font-body)' }}>{error}</p>}

      <button
        onClick={() => void handleSave()}
        disabled={saving}
        style={{ width: '100%', padding: 11, borderRadius: 8, background: '#14532d', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13.5, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}
      >
        {saving ? 'Saving…' : 'Save Override'}
      </button>
    </div>
  )
}

const backLinkStyle: CSSProperties = { fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#7a7260', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }
const rowButtonStyle: CSSProperties = { textAlign: 'left', padding: '11px 14px', borderRadius: 10, background: '#ffffff', border: '1px solid #eceae3', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13.5, color: '#14532d', cursor: 'pointer' }
