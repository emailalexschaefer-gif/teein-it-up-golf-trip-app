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

// Score Management redesign — organiser adjudication reason model,
// matching the exact requested category list. "Paper/manual scorecard"
// is included here too (not just in the separate Enter Paper Scorecard
// workflow) since an organiser correcting an existing digital entry may
// still be doing so because a hole was actually recorded from a paper
// card mid-round.
const REASONS = ['Incorrect entry', 'Scoring dispute', 'Phone issue', 'Technical issue', 'Paper/manual scorecard', 'Other']

export default function AdminScoreOverridePanel({ tripId, rounds }: { tripId: string; rounds: RoundOption[] }) {
  const [selectedRoundId, setSelectedRoundId] = useState<string>(
    rounds.find(r => r.status === 'active')?.id ?? [...rounds].sort((a, b) => b.play_date.localeCompare(a.play_date))[0]?.id ?? ''
  )
  const [groups, setGroups] = useState<GroupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerRow | null>(null)
  // Package 3 final — the two organiser tools the brief explicitly
  // requires be "clearly separated." mode governs the selector UI text
  // and which component the selected player flows into; everything
  // else (round selection, player list/search, load()) is completely
  // shared between the two, since both need the same round-scoped
  // roster.
  const [mode, setMode] = useState<'override' | 'paper'>('override')

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
  // Package 3 final — caught during Mode 2 development: this effect
  // still called setEditingHole(null) even though that state was
  // removed when the tile-grid single-hole flow was replaced by
  // FullScorecardOverride (Package 3 Mode 1). Same class of stale-
  // setter bug as the earlier setSelectedGroupId/hasUnresolvedMismatch
  // issues this session — a state removal that missed one remaining
  // reference. Confirmed via full-file search: zero other references
  // to editingHole/setEditingHole exist anywhere in this file now.
  useEffect(() => { void load(); setSearchTerm(''); setSelectedPlayer(null) }, [tripId, selectedRoundId]) // eslint-disable-line react-hooks/exhaustive-deps

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

      {/* Package 3 final, item 2 — "two clearly separated organiser
          tools." A simple segmented toggle, not a dropdown buried among
          other settings — this is the primary decision the organiser
          makes before anything else in Score Management. */}
      {!selectedPlayer && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button
            onClick={() => setMode('override')}
            style={{
              flex: 1, padding: '9px 8px', borderRadius: 8, border: `1.5px solid ${mode === 'override' ? '#14532d' : '#d1d5db'}`,
              background: mode === 'override' ? '#14532d' : '#fff', color: mode === 'override' ? '#fff' : '#374151',
              fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12, cursor: 'pointer',
            }}
          >
            Override Existing Score
          </button>
          <button
            onClick={() => setMode('paper')}
            style={{
              flex: 1, padding: '9px 8px', borderRadius: 8, border: `1.5px solid ${mode === 'paper' ? '#14532d' : '#d1d5db'}`,
              background: mode === 'paper' ? '#14532d' : '#fff', color: mode === 'paper' ? '#fff' : '#374151',
              fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12, cursor: 'pointer',
            }}
          >
            Enter Paper Scorecard
          </button>
        </div>
      )}

      {loading ? null : selectedPlayer && selectedRound ? (
        mode === 'paper' ? (
          <PaperScorecardEntry
            tripId={tripId} roundId={selectedRoundId} player={selectedPlayer} roundName={selectedRound.name}
            onCancel={() => setSelectedPlayer(null)}
            onSaved={() => { setSelectedPlayer(null); void load() }}
          />
        ) : (
          <FullScorecardOverride
            tripId={tripId} roundId={selectedRoundId} player={selectedPlayer} roundName={selectedRound.name}
            onCancel={() => setSelectedPlayer(null)}
            onSaved={() => { setSelectedPlayer(null); void load() }}
          />
        )
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

function FullScorecardOverride({ tripId, roundId, player, roundName, onCancel, onSaved }: {
  tripId: string; roundId: string; player: PlayerRow; roundName: string
  onCancel: () => void; onSaved: () => void
}) {
  // Package 3 final — "load the complete existing scorecard... edit
  // one hole, multiple holes, or all remaining holes... do not make
  // Darren open 18 separate edit modals." Every hole's current
  // gross/no-return state is the local editable draft from the start —
  // player.holes is only ever read to compute the ORIGINAL values for
  // diffing (originalByHole below), never mutated directly.
  const [drafts, setDrafts] = useState<Record<number, { gross: string; isNoReturn: boolean }>>(() => {
    const initial: Record<number, { gross: string; isNoReturn: boolean }> = {}
    for (const h of player.holes) initial[h.holeNumber] = { gross: h.grossScore !== null ? String(h.grossScore) : '', isNoReturn: h.isNoReturn }
    return initial
  })
  const [reason, setReason] = useState(REASONS[0])
  const [otherReason, setOtherReason] = useState('')
  const [stage, setStage] = useState<'edit' | 'confirm'>('edit')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const originalByHole = new Map(player.holes.map(h => [h.holeNumber, h]))
  const finalReason = reason === 'Other' ? `Other — ${otherReason.trim()}` : reason

  function projectedPts(h: HoleRow, draft: { gross: string; isNoReturn: boolean }): number {
    if (draft.isNoReturn) return 0
    if (draft.gross === '' || player.playingHandicap == null) return 0
    try {
      return calculateStableford({
        grossScore: Number(draft.gross), par: h.par, strokeIndex: h.strokeIndex,
        playingHandicap: player.playingHandicap, holesInRound: player.holesInRound,
      })
    } catch { return 0 }
  }

  // A hole only counts as "changed" if its draft genuinely differs from
  // the original — untouched holes never get sent to the server at
  // all, matching "Review Changes shows exactly N changes," not every
  // hole on the card.
  const changedHoles = player.holes.filter(h => {
    const d = drafts[h.holeNumber]
    if (!d) return false
    if (d.isNoReturn !== h.isNoReturn) return true
    if (d.isNoReturn) return false
    return d.gross !== (h.grossScore !== null ? String(h.grossScore) : '')
  })

  const projectedRoundTotal = player.holes.reduce((sum, h) => {
    const d = drafts[h.holeNumber]
    if (!d) return sum + (h.stablefordPts ?? 0)
    return sum + projectedPts(h, d)
  }, 0)

  const allDraftsValid = player.holes.every(h => {
    const d = drafts[h.holeNumber]
    return d && (d.isNoReturn || (d.gross !== '' && Number(d.gross) >= 1 && Number(d.gross) <= 20))
  })

  function updateDraft(holeNumber: number, patch: Partial<{ gross: string; isNoReturn: boolean }>) {
    setDrafts(prev => ({ ...prev, [holeNumber]: { ...prev[holeNumber], ...patch } }))
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/scorecards/${player.scorecardId}/batch-override`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: finalReason,
          changes: changedHoles.map(h => {
            const d = drafts[h.holeNumber]
            return { holeNumber: h.holeNumber, grossScore: d.isNoReturn ? null : Number(d.gross), isNoReturn: d.isNoReturn }
          }),
        }),
      })
      const resBody = await res.json().catch(() => ({}))
      if (!res.ok && res.status !== 207) {
        setError(resBody.error ?? "Couldn't save these changes. Please try again.")
        setSaving(false)
        return
      }
      if (resBody.partial) {
        // Some holes saved, some didn't — surfaced explicitly rather
        // than silently claiming full success or discarding the ones
        // that did save (see batch-override/route.ts's own comment).
        setError(`Saved ${resBody.succeeded?.length ?? 0} of ${changedHoles.length} holes. Failed: ${(resBody.failed ?? []).map((f: { holeNumber: number }) => `H${f.holeNumber}`).join(', ')}. Please retry the failed holes.`)
        setSaving(false)
        return
      }
      onSaved()
    } catch {
      setError("Couldn't save these changes. Check your connection and try again.")
      setSaving(false)
    }
  }

  if (stage === 'confirm') {
    return (
      <div style={{ background: '#ffffff', border: '1.5px solid #d9c9a3', borderRadius: 12, padding: 14 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 13, color: '#14532d', marginBottom: 10 }}>
          {player.playerName} — {roundName}
        </div>
        {/* Item 8 — only changed holes shown here, never the full card
            again during review. */}
        {changedHoles.map(h => {
          const d = drafts[h.holeNumber]
          const newPts = projectedPts(h, d)
          const oldValue = h.isNoReturn ? 'NR' : (h.grossScore ?? '—')
          const newValue = d.isNoReturn ? 'NR' : (d.gross || '—')
          return (
            <div key={h.holeNumber} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid #eceae3' }}>
              <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5, color: '#14532d' }}>Hole {h.holeNumber}</div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#374151' }}>
                Gross: <strong>{oldValue}</strong> → <strong style={{ color: '#a1791f' }}>{newValue}</strong>
              </div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#374151' }}>
                Stableford: <strong>{h.stablefordPts ?? 0}</strong> → <strong style={{ color: '#a1791f' }}>{newPts}</strong>
              </div>
            </div>
          )
        })}
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#374151', marginBottom: 4 }}>
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
      <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, color: '#14532d', margin: '8px 0 2px' }}>{player.playerName}</div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af', marginBottom: 10 }}>{roundName} · Round total: {player.roundTotal} pts</div>

      {/* Item 6 — reason selected once for the whole batch, not
          per-hole, matching "Review Changes... Reason: Scoring
          dispute" (a single reason covering every changed hole in the
          batch). */}
      <select
        value={reason} onChange={e => setReason(e.target.value)}
        style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '9px 10px', fontFamily: 'var(--font-body)', fontSize: 13, marginBottom: reason === 'Other' ? 8 : 12, background: '#fff' }}
      >
        {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
      {reason === 'Other' && (
        <input
          value={otherReason} onChange={e => setOtherReason(e.target.value)}
          placeholder="Please explain"
          style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '9px 10px', fontFamily: 'var(--font-body)', fontSize: 13, marginBottom: 12 }}
        />
      )}

      {/* Item 5 — mobile-first: large touch targets, numeric keyboard,
          minimal modal use (none at all here — the whole card is
          editable inline), obvious hole number and par per row. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '50vh', overflowY: 'auto' }}>
        {player.holes.map((h, idx) => {
          const d = drafts[h.holeNumber] ?? { gross: '', isNoReturn: false }
          const original = originalByHole.get(h.holeNumber)
          const isChanged = changedHoles.some(c => c.holeNumber === h.holeNumber)
          return (
            <div
              key={h.holeNumber}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8,
                background: isChanged ? '#fdf3d9' : (original?.adminOverridden ? '#f0fdf4' : '#faf9f6'),
                border: `1px solid ${isChanged ? '#e8c96a' : '#eceae3'}`,
              }}
            >
              <div style={{ width: 44, flexShrink: 0, fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5, color: '#14532d' }}>
                H{h.holeNumber}
              </div>
              <div style={{ width: 40, flexShrink: 0, fontFamily: 'var(--font-body)', fontSize: 11, color: '#9ca3af' }}>
                Par {h.par}
              </div>
              <input
                type="number" inputMode="numeric" min="1" max="20"
                value={d.gross} disabled={d.isNoReturn}
                onChange={e => updateDraft(h.holeNumber, { gross: e.target.value })}
                // Item 5 — auto-advance to the next hole's input once a
                // plausible score is entered, so the organiser can move
                // straight down a physical scorecard without tapping
                // each field individually.
                onInput={e => {
                  const val = (e.target as HTMLInputElement).value
                  if (val.length >= 1 && Number(val) >= 1 && Number(val) <= 20) {
                    const next = document.getElementById(`override-hole-${idx + 1}`)
                    if (next) (next as HTMLInputElement).focus()
                  }
                }}
                id={`override-hole-${idx}`}
                placeholder="—"
                style={{ width: 56, flexShrink: 0, border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 6px', fontFamily: 'var(--font-body)', fontSize: 16, textAlign: 'center', background: d.isNoReturn ? '#f3f4f6' : '#fff' }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-body)', fontSize: 10.5, color: '#7a7260', flexShrink: 0 }}>
                <input type="checkbox" checked={d.isNoReturn} onChange={e => updateDraft(h.holeNumber, { isNoReturn: e.target.checked, gross: '' })} />
                NR
              </label>
              {original?.adminOverridden && !isChanged && <span style={{ fontSize: 9, color: '#166534', fontWeight: 700, flexShrink: 0 }}>⚙</span>}
            </div>
          )
        })}
      </div>

      {error && <p style={{ color: '#dc2626', fontSize: 11.5, margin: '10px 0 0', fontFamily: 'var(--font-body)' }}>{error}</p>}

      <button
        onClick={() => setStage('confirm')}
        disabled={!allDraftsValid || changedHoles.length === 0 || (reason === 'Other' && otherReason.trim().length === 0)}
        style={{
          width: '100%', marginTop: 12, padding: 11, borderRadius: 8, background: '#14532d', color: '#fff', border: 'none',
          fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer',
          opacity: (!allDraftsValid || changedHoles.length === 0 || (reason === 'Other' && otherReason.trim().length === 0)) ? 0.6 : 1,
        }}
      >
        {changedHoles.length === 0 ? 'No changes yet' : `Review ${changedHoles.length} Change${changedHoles.length === 1 ? '' : 's'} →`}
      </button>
    </div>
  )
}

// Package 3 final, item 19 — a restricted subset of the shared reason
// model for Paper Scorecard specifically, since "incorrect entry" and
// "scoring dispute" don't apply to a card that was never digitally
// entered at all.
const PAPER_REASONS = ['Paper/manual scorecard', 'Phone issue', 'Technical issue', 'Other']

function PaperScorecardEntry({ tripId, roundId, player, roundName, onCancel, onSaved }: {
  tripId: string; roundId: string; player: PlayerRow; roundName: string
  onCancel: () => void; onSaved: () => void
}) {
  // Package 3 final, item 16/17 — "blank 9/18-hole rapid-entry card."
  // Deliberately starts genuinely blank (not pre-populated from any
  // existing digital entries, unlike FullScorecardOverride) — this
  // player didn't meaningfully participate digitally, so there's
  // nothing meaningful to pre-fill from. par/strokeIndex/holeNumber
  // still come from player.holes (the real round holes, per the
  // explicit "blank card uses the actual round holes, par and stroke
  // indexes" requirement) — only gross/isNoReturn start empty.
  const [drafts, setDrafts] = useState<Record<number, { gross: string; isNoReturn: boolean }>>(() => {
    const initial: Record<number, { gross: string; isNoReturn: boolean }> = {}
    for (const h of player.holes) initial[h.holeNumber] = { gross: '', isNoReturn: false }
    return initial
  })
  const [reason, setReason] = useState(PAPER_REASONS[0])
  const [otherReason, setOtherReason] = useState('')
  const [stage, setStage] = useState<'edit' | 'confirm'>('edit')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const finalReason = reason === 'Other' ? `Other — ${otherReason.trim()}` : reason

  function projectedPts(h: HoleRow, draft: { gross: string; isNoReturn: boolean }): number {
    if (draft.isNoReturn) return 0
    if (draft.gross === '' || player.playingHandicap == null) return 0
    try {
      return calculateStableford({
        grossScore: Number(draft.gross), par: h.par, strokeIndex: h.strokeIndex,
        playingHandicap: player.playingHandicap, holesInRound: player.holesInRound,
      })
    } catch { return 0 }
  }

  const enteredCount = player.holes.filter(h => {
    const d = drafts[h.holeNumber]
    return d && (d.isNoReturn || d.gross !== '')
  }).length
  // Item 18 — "before final save, every playable hole must have a
  // gross score OR explicit Pick Up/NR state." This IS the completion
  // gate — every hole, not just changed ones, since there's no prior
  // digital state to diff against.
  const allEntered = enteredCount === player.holes.length
  const projectedTotal = player.holes.reduce((sum, h) => {
    const d = drafts[h.holeNumber]
    return sum + (d ? projectedPts(h, d) : 0)
  }, 0)

  function updateDraft(holeNumber: number, patch: Partial<{ gross: string; isNoReturn: boolean }>) {
    setDrafts(prev => ({ ...prev, [holeNumber]: { ...prev[holeNumber], ...patch } }))
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/scorecards/${player.scorecardId}/batch-override`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: finalReason,
          // Item 20 — every hole is sent, not just ones that "changed"
          // (there's no prior digital value to diff against for a
          // blank card) — this is what actually creates the
          // capture_role='self' row for every hole via
          // applyHoleOverride's own existing create-if-missing branch
          // (the exact same mechanism Mode 1 already uses for the
          // "lost/dead phone, hole never entered" case), establishing
          // this as the player's one official scorecard. No separate
          // "paper scorecard" table or fabricated marker rows — same
          // canonical score_entries model everything else already
          // reads.
          changes: player.holes.map(h => {
            const d = drafts[h.holeNumber]
            return { holeNumber: h.holeNumber, grossScore: d.isNoReturn ? null : Number(d.gross), isNoReturn: d.isNoReturn }
          }),
        }),
      })
      const resBody = await res.json().catch(() => ({}))
      if (!res.ok && res.status !== 207) {
        setError(resBody.error ?? "Couldn't save this scorecard. Please try again.")
        setSaving(false)
        return
      }
      if (resBody.partial) {
        setError(`Saved ${resBody.succeeded?.length ?? 0} of ${player.holes.length} holes. Failed: ${(resBody.failed ?? []).map((f: { holeNumber: number }) => `H${f.holeNumber}`).join(', ')}. Please retry the failed holes.`)
        setSaving(false)
        return
      }
      onSaved()
    } catch {
      setError("Couldn't save this scorecard. Check your connection and try again.")
      setSaving(false)
    }
  }

  if (stage === 'confirm') {
    return (
      <div style={{ background: '#ffffff', border: '1.5px solid #d9c9a3', borderRadius: 12, padding: 14 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 13, color: '#14532d', marginBottom: 4 }}>
          {player.playerName} — {roundName}
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af', marginBottom: 10 }}>Paper scorecard entry</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, color: '#a1791f', marginBottom: 2 }}>
          {projectedTotal} pts
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#6b7280', marginBottom: 14 }}>{player.holes.length}/{player.holes.length} holes entered</div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af', marginBottom: 14 }}>
          Reason: {finalReason}
        </div>
        {error && <p style={{ color: '#dc2626', fontSize: 11.5, marginBottom: 8, fontFamily: 'var(--font-body)' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setStage('edit')} disabled={saving} style={{ flex: 1, padding: 10, borderRadius: 8, background: '#f3f4f6', border: '1px solid #d1d5db', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            ← Back
          </button>
          <button onClick={() => void handleSave()} disabled={saving} style={{ flex: 1, padding: 10, borderRadius: 8, background: '#14532d', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save Official Scorecard'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: '#ffffff', border: '1.5px solid #d9c9a3', borderRadius: 12, padding: 14 }}>
      <button onClick={onCancel} style={backLinkStyle}>← Cancel</button>
      <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, color: '#14532d', margin: '8px 0 2px' }}>{player.playerName}</div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af', marginBottom: 10 }}>{roundName} · Paper scorecard entry</div>

      <select
        value={reason} onChange={e => setReason(e.target.value)}
        style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '9px 10px', fontFamily: 'var(--font-body)', fontSize: 13, marginBottom: reason === 'Other' ? 8 : 12, background: '#fff' }}
      >
        {PAPER_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
      {reason === 'Other' && (
        <input
          value={otherReason} onChange={e => setOtherReason(e.target.value)}
          placeholder="Please explain"
          style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '9px 10px', fontFamily: 'var(--font-body)', fontSize: 13, marginBottom: 12 }}
        />
      )}

      {/* Item 17/18 — hole number, par, gross input, NR support, running
          "N/N holes entered" + live Stableford preview, per the exact
          requested layout. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: allEntered ? '#166534' : '#a1791f' }}>
          {enteredCount}/{player.holes.length} holes entered
        </span>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#14532d' }}>
          {projectedTotal} pts
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '50vh', overflowY: 'auto' }}>
        {player.holes.map((h, idx) => {
          const d = drafts[h.holeNumber] ?? { gross: '', isNoReturn: false }
          const filled = d.isNoReturn || d.gross !== ''
          return (
            <div
              key={h.holeNumber}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8,
                background: filled ? '#f0fdf4' : '#faf9f6', border: `1px solid ${filled ? '#bbf7d0' : '#eceae3'}`,
              }}
            >
              <div style={{ width: 44, flexShrink: 0, fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5, color: '#14532d' }}>
                H{h.holeNumber}
              </div>
              <div style={{ width: 40, flexShrink: 0, fontFamily: 'var(--font-body)', fontSize: 11, color: '#9ca3af' }}>
                Par {h.par}
              </div>
              <input
                type="number" inputMode="numeric" min="1" max="20"
                value={d.gross} disabled={d.isNoReturn}
                onChange={e => updateDraft(h.holeNumber, { gross: e.target.value })}
                onInput={e => {
                  const val = (e.target as HTMLInputElement).value
                  if (val.length >= 1 && Number(val) >= 1 && Number(val) <= 20) {
                    const next = document.getElementById(`paper-hole-${idx + 1}`)
                    if (next) (next as HTMLInputElement).focus()
                  }
                }}
                id={`paper-hole-${idx}`}
                placeholder="—"
                style={{ width: 56, flexShrink: 0, border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 6px', fontFamily: 'var(--font-body)', fontSize: 16, textAlign: 'center', background: d.isNoReturn ? '#f3f4f6' : '#fff' }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-body)', fontSize: 10.5, color: '#7a7260', flexShrink: 0 }}>
                <input type="checkbox" checked={d.isNoReturn} onChange={e => updateDraft(h.holeNumber, { isNoReturn: e.target.checked, gross: '' })} />
                NR
              </label>
            </div>
          )
        })}
      </div>

      {error && <p style={{ color: '#dc2626', fontSize: 11.5, margin: '10px 0 0', fontFamily: 'var(--font-body)' }}>{error}</p>}

      <button
        onClick={() => setStage('confirm')}
        disabled={!allEntered || (reason === 'Other' && otherReason.trim().length === 0)}
        style={{
          width: '100%', marginTop: 12, padding: 11, borderRadius: 8, background: '#14532d', color: '#fff', border: 'none',
          fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer',
          opacity: (!allEntered || (reason === 'Other' && otherReason.trim().length === 0)) ? 0.6 : 1,
        }}
      >
        {allEntered ? 'Preview & Save →' : `${player.holes.length - enteredCount} hole${player.holes.length - enteredCount === 1 ? '' : 's'} remaining`}
      </button>
    </div>
  )
}

const backLinkStyle = { fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#7a7260', background: 'none', border: 'none', cursor: 'pointer', padding: 0 } as const
const rowButtonStyle = { textAlign: 'left', padding: '11px 14px', borderRadius: 10, background: '#ffffff', border: '1px solid #eceae3', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13.5, color: '#14532d', cursor: 'pointer', width: '100%' } as const
