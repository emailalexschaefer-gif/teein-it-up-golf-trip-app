'use client'

import { useEffect, useState } from 'react'
import { calculateStableford } from '@/lib/scoring/stableford'
import { matchesPlayerSearch } from '@/lib/scoring/multiRound'

/**
 * Priority 3 — Score Management, wired into My HQ. Two ways in, one
 * editor: "Search player" (primary, searches by name across every
 * group in the selected round) and the existing Round -> Group ->
 * Player drill-down (secondary) both end at the exact same hole grid
 * and OverrideForm — there was never a risk of two edit systems here,
 * since both paths were always just two ways of picking the same
 * player object.
 *
 * Every value shown here comes straight from /admin-scores (a read of
 * the exact same score_entries the live scoring shells write to), and
 * saving calls the existing high-integrity /override endpoint (old
 * value, new value, reason, who, when — all recorded there, not here).
 * The round-total preview uses calculateStableford — the same canonical
 * function every scoring shell already uses — purely for a live
 * "before you save" display; the actual persisted value still comes
 * from the server's own recalculation via the existing trigger, not
 * from this preview. This is not a parallel scoring engine, it's the
 * same one, called once more for a confirmation screen.
 */
interface RoundOption { id: string; name: string; status: string; play_date: string }
interface HoleRow { holeNumber: number; par: number; strokeIndex: number; grossScore: number | null; isNoReturn: boolean; stablefordPts: number | null; adminOverridden: boolean }
interface PlayerRow { scorecardId: string; playerId: string; playerName: string; playingHandicap: number | null; holesInRound: number; groupId: string | null; groupName: string; roundTotal: number; holes: HoleRow[] }
interface GroupRow { groupId: string | null; groupName: string; players: PlayerRow[] }

const REASONS = ['Incorrect entry', 'Lost/dead phone', 'Scoring dispute', 'Technical issue', 'Other']

export default function AdminScoreOverridePanel({ tripId, rounds }: { tripId: string; rounds: RoundOption[] }) {
  const [selectedRoundId, setSelectedRoundId] = useState<string>(
    rounds.find(r => r.status === 'active')?.id ?? [...rounds].sort((a, b) => b.play_date.localeCompare(a.play_date))[0]?.id ?? ''
  )
  const [groups, setGroups] = useState<GroupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerRow | null>(null)
  const [editingHole, setEditingHole] = useState<HoleRow | null>(null)

  async function load() {
    if (!selectedRoundId) { setLoading(false); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/trips/${tripId}/rounds/${selectedRoundId}/admin-scores`)
      if (res.ok) setGroups((await res.json()).groups ?? [])
    } catch { /* panel simply shows nothing new until the next successful load */ }
    setLoading(false)
  }
  // A3 fix (Package 3) traded the group drill-down (selectedGroupId) for
  // a flat, searchable player list — that state was intentionally
  // removed. This effect's actual purpose (reset transient UI state when
  // the organiser switches rounds) still applies, just to what replaced
  // it: searchTerm is the equivalent "which subset is currently shown"
  // state now, so that's what gets cleared here instead. The stale
  // setSelectedGroupId(null) call — referencing a setter with no
  // corresponding state left anywhere in this file — is removed, not
  // patched with a dummy setter, since the underlying group-selection
  // concept it managed no longer exists in this component at all.
  useEffect(() => { void load(); setSearchTerm(''); setSelectedPlayer(null); setEditingHole(null) }, [tripId, selectedRoundId]) // eslint-disable-line react-hooks/exhaustive-deps

  const allPlayers = groups.flatMap(g => g.players)
  const searchResults = searchTerm.trim().length > 0
    ? allPlayers.filter(p => matchesPlayerSearch(p.playerName, searchTerm))
    : []
  const selectedRound = rounds.find(r => r.id === selectedRoundId)

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        ⚙ Score Management
      </div>

      {rounds.length > 1 && (
        <select
          value={selectedRoundId}
          onChange={e => setSelectedRoundId(e.target.value)}
          style={{ width: '100%', marginBottom: 10, padding: '9px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontFamily: 'var(--font-body)', fontSize: 13, background: '#fff' }}
        >
          {[...rounds].sort((a, b) => a.play_date.localeCompare(b.play_date)).map(r => (
            <option key={r.id} value={r.id}>{r.name} {r.status === 'active' ? '· LIVE' : '· Complete'}</option>
          ))}
        </select>
      )}

      {loading ? null : editingHole && selectedPlayer && selectedRound ? (
        <OverrideForm
          tripId={tripId} roundId={selectedRoundId} scorecardId={selectedPlayer.scorecardId}
          hole={editingHole} player={selectedPlayer} roundName={selectedRound.name}
          onCancel={() => setEditingHole(null)}
          onSaved={() => { setEditingHole(null); void load() }}
        />
      ) : selectedPlayer ? (
        <div>
          <button onClick={() => setSelectedPlayer(null)} style={backLinkStyle}>← {selectedPlayer.groupName}</button>
          <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, color: '#14532d', margin: '8px 0 2px' }}>{selectedPlayer.playerName}</div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af', marginBottom: 10 }}>Round total: {selectedPlayer.roundTotal} pts</div>
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
      ) : (
        <div>
          <input
            value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            placeholder="🔎 Search player"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #d1d5db', fontFamily: 'var(--font-body)', fontSize: 13.5, marginBottom: 10 }}
          />
          {searchTerm.trim().length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {searchResults.length === 0 && (
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af', padding: '8px 2px' }}>No matching player in this round.</div>
              )}
              {searchResults.map(p => (
                <button key={p.scorecardId} onClick={() => setSelectedPlayer(p)} style={rowButtonStyle}>
                  <div style={{ fontWeight: 700 }}>{p.playerName}</div>
                  <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500, marginTop: 1 }}>{p.groupName} · {p.roundTotal} pts</div>
                </button>
              ))}
            </div>
          ) : (
            // A3 fix — previously defaulted to a group drill-down
            // requiring an extra tap before any player was visible at
            // all ("blank search box requiring Darren to guess names,"
            // just via groups instead of literally-blank search). Now
            // shows every player in the round immediately, matching the
            // brief's exact example format (name / holes progress /
            // Manage Scorecard). Search above still filters this same
            // list; groups remain visible as a secondary label per row
            // rather than a required navigation step.
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {allPlayers.length === 0 && (
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af' }}>No scorecards for this round yet.</div>
              )}
              {allPlayers.map(p => {
                const holesPlayed = p.holes.filter(h => h.grossScore != null || h.isNoReturn).length
                return (
                  <button key={p.scorecardId} onClick={() => setSelectedPlayer(p)} style={rowButtonStyle}>
                    <div style={{ fontWeight: 700 }}>{p.playerName}</div>
                    <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500, marginTop: 1 }}>
                      {p.groupName} · {holesPlayed}/{p.holesInRound} holes · Manage Scorecard →
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function OverrideForm({ tripId, roundId, scorecardId, hole, player, roundName, onCancel, onSaved }: {
  tripId: string; roundId: string; scorecardId: string; hole: HoleRow; player: PlayerRow; roundName: string
  onCancel: () => void; onSaved: () => void
}) {
  const [grossScore, setGrossScore] = useState(hole.grossScore !== null ? String(hole.grossScore) : '')
  const [isNoReturn, setIsNoReturn] = useState(hole.isNoReturn)
  const [reason, setReason] = useState(REASONS[0])
  const [otherReason, setOtherReason] = useState('')
  const [stage, setStage] = useState<'edit' | 'confirm'>('edit')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const finalReason = reason === 'Other' ? otherReason.trim() : reason
  const validGross = isNoReturn || (grossScore !== '' && Number(grossScore) >= 1 && Number(grossScore) <= 20)

  let projectedHolePts = 0
  if (!isNoReturn && validGross && player.playingHandicap != null) {
    try {
      projectedHolePts = calculateStableford({
        grossScore: Number(grossScore), par: hole.par, strokeIndex: hole.strokeIndex,
        playingHandicap: player.playingHandicap, holesInRound: player.holesInRound,
      })
    } catch { projectedHolePts = 0 }
  }
  const currentHolePts = hole.stablefordPts ?? 0
  const projectedRoundTotal = player.roundTotal - currentHolePts + projectedHolePts

  const currentValue = hole.isNoReturn ? 'No Return' : (hole.grossScore ?? '—')
  const proposedValue = isNoReturn ? 'No Return' : (grossScore || '—')

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/scorecards/${scorecardId}/override`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holeNumber: hole.holeNumber, grossScore: isNoReturn ? null : Number(grossScore), isNoReturn, reason: finalReason }),
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

  if (stage === 'confirm') {
    return (
      <div style={{ background: '#ffffff', border: '1.5px solid #d9c9a3', borderRadius: 12, padding: 14 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 13, color: '#14532d', marginBottom: 10 }}>
          {player.playerName} — {roundName}
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#374151', marginBottom: 4 }}>
          Hole {hole.holeNumber}: <strong>{currentValue}</strong> → <strong style={{ color: '#a1791f' }}>{proposedValue}</strong>
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#374151', marginBottom: 4 }}>
          Points this hole: <strong>{currentHolePts}</strong> → <strong style={{ color: '#a1791f' }}>{projectedHolePts}</strong>
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#374151', marginBottom: 12 }}>
          Round total: <strong>{player.roundTotal} pts</strong> → <strong style={{ color: '#a1791f' }}>{projectedRoundTotal} pts</strong>
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af', marginBottom: 14 }}>
          Reason: {finalReason}
        </div>
        {error && <p style={{ color: '#dc2626', fontSize: 11.5, marginBottom: 8, fontFamily: 'var(--font-body)' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setStage('edit')} disabled={saving} style={{ flex: 1, padding: 10, borderRadius: 8, background: '#f3f4f6', border: '1px solid #d1d5db', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            ← Back
          </button>
          <button onClick={() => void handleSave()} disabled={saving} style={{ flex: 1, padding: 10, borderRadius: 8, background: '#14532d', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Confirm & Save'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: '#ffffff', border: '1.5px solid #d9c9a3', borderRadius: 12, padding: 14 }}>
      <button onClick={onCancel} style={backLinkStyle}>← Cancel</button>
      <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, color: '#14532d', margin: '8px 0 4px' }}>
        {player.playerName} — Hole {hole.holeNumber} (Par {hole.par})
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

      <select
        value={reason} onChange={e => setReason(e.target.value)}
        style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '9px 10px', fontFamily: 'var(--font-body)', fontSize: 13, marginBottom: reason === 'Other' ? 8 : 12, background: '#fff' }}
      >
        {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
      {reason === 'Other' && (
        <input
          value={otherReason} onChange={e => setOtherReason(e.target.value)}
          placeholder="Describe the reason"
          style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '9px 10px', fontFamily: 'var(--font-body)', fontSize: 13, marginBottom: 12 }}
        />
      )}

      <button
        onClick={() => setStage('confirm')}
        disabled={!validGross || (reason === 'Other' && otherReason.trim().length === 0)}
        style={{ width: '100%', padding: 11, borderRadius: 8, background: '#14532d', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', opacity: (!validGross || (reason === 'Other' && otherReason.trim().length === 0)) ? 0.6 : 1 }}
      >
        Review Changes →
      </button>
    </div>
  )
}

const backLinkStyle = { fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#7a7260', background: 'none', border: 'none', cursor: 'pointer', padding: 0 } as const
const rowButtonStyle = { textAlign: 'left', padding: '11px 14px', borderRadius: 10, background: '#ffffff', border: '1px solid #eceae3', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13.5, color: '#14532d', cursor: 'pointer', width: '100%' } as const
