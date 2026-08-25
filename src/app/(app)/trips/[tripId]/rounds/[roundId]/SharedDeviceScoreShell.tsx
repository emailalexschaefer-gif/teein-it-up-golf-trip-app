'use client'

import { useEffect, useState } from 'react'
import { calculateStableford } from '@/lib/scoring/stableford'
import { queueScoreEntry } from '@/lib/db/dexie'
import { syncScoreQueue } from '@/lib/db/sync'

interface Round { id: string; name: string; holes: number; par?: number | null }
interface HoleRow { id: string; hole_number: number; par: number; stroke_index: number; distance?: number | null }
interface ScorecardFull { id: string; player_id: string; playing_handicap: number | null }

interface Props {
  tripId: string; tripName: string; round: Round
  myScorecard: ScorecardFull
  paperPlayerId: string
  paperPlayerName: string
  paperPlayingHandicap: number | null
}

/**
 * Add-on 1 — deliberately a NEW, standalone shell, not a mode flag
 * bolted onto SelfMarkerScoreShell. That component's entire structure
 * (partnerCandidates, round_markers pairing, reconciliation status,
 * mismatch comparison) is built around two INDEPENDENT digital
 * entries needing to agree — none of that applies here, where Alex's
 * entry for Mick simply IS Mick's official score by construction.
 * Bolting this on would mean threading a shared-device flag through
 * every one of those unrelated code paths just to suppress them,
 * which is a worse outcome than a second, purpose-built component
 * that only contains what this mode actually needs.
 *
 * KNOWN LIMITATION, reported honestly: this shell submits both
 * players' scores via direct online fetch calls, not through the
 * offline-first Dexie queue Alex's OWN score would otherwise go
 * through in SelfMarkerScoreShell (Alex's own entry below does still
 * use queueScoreEntry — only Mick's write is a direct fetch, since the
 * shared-device-score endpoint has no offline-queue equivalent built
 * yet). A genuinely offline round would need this extended before
 * field use in areas with poor connectivity.
 */
export default function SharedDeviceScoreShell({ tripId, round, myScorecard, paperPlayerName, paperPlayingHandicap }: Props) {
  const [holes, setHoles] = useState<HoleRow[]>([])
  const [holesLoaded, setHolesLoaded] = useState(false)
  const [holeIdx, setHoleIdx] = useState(0)

  // Item 2 — "one-time confirmation screen... before Alex reaches Hole
  // 1." Persisted per round+player via localStorage — a lightweight,
  // client-only mechanism deliberately chosen over a schema change,
  // since re-showing this once per browser/device (rather than a
  // perfectly-tracked server-side "seen" flag) is an acceptable trade
  // for not touching the schema for a one-time educational screen.
  const eduKey = `shared-device-edu-seen:${round.id}:${myScorecard.player_id}`
  const [showEducation, setShowEducation] = useState(true)
  useEffect(() => {
    try { setShowEducation(localStorage.getItem(eduKey) !== '1') } catch { /* localStorage unavailable — default to showing it once per mount, safe */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [myGross, setMyGross] = useState('')
  const [myNoReturn, setMyNoReturn] = useState(false)
  const [paperGross, setPaperGross] = useState('')
  const [paperNoReturn, setPaperNoReturn] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/trips/${tripId}/rounds/${round.id}/holes`)
      .then(res => res.ok ? res.json() : null)
      .then(body => { if (!cancelled && body?.holes) setHoles(body.holes) })
      .finally(() => { if (!cancelled) setHolesLoaded(true) })
    return () => { cancelled = true }
  }, [tripId, round.id])

  const hole = holes[holeIdx]
  const totalHoles = round.holes ?? holes.length

  function myPts(): number {
    if (myNoReturn || myGross === '' || !hole || myScorecard.playing_handicap == null) return 0
    try { return calculateStableford({ grossScore: Number(myGross), par: hole.par, strokeIndex: hole.stroke_index, playingHandicap: myScorecard.playing_handicap, holesInRound: totalHoles }) }
    catch { return 0 }
  }
  function paperPts(): number {
    if (paperNoReturn || paperGross === '' || !hole || paperPlayingHandicap == null) return 0
    try { return calculateStableford({ grossScore: Number(paperGross), par: hole.par, strokeIndex: hole.stroke_index, playingHandicap: paperPlayingHandicap, holesInRound: totalHoles }) }
    catch { return 0 }
  }

  const canConfirm = hole !== undefined
    && (myNoReturn || (myGross !== '' && Number(myGross) >= 1 && Number(myGross) <= 20))
    && (paperNoReturn || (paperGross !== '' && Number(paperGross) >= 1 && Number(paperGross) <= 20))

  async function confirmHole() {
    if (!canConfirm || !hole || saving) return
    setSaving(true)
    setError('')
    try {
      // Item 4/5 — Alex's own score, queued through the exact same
      // offline-first mechanism every other digital player already
      // uses (queueScoreEntry + syncScoreQueue) — no change to how
      // Alex's OWN score is handled.
      await queueScoreEntry({
        scorecardId: myScorecard.id, holeId: hole.id, captureRole: 'self',
        grossScore: myNoReturn ? null : Number(myGross), isNoReturn: myNoReturn,
        enteredAt: new Date().toISOString(),
      })
      void syncScoreQueue()

      // Mick's official score — direct write via applyHoleOverride
      // (through the shared-device-score endpoint), not a marker row.
      // This IS the mechanism that makes "no reconciliation for Mick"
      // true: there is no second, independent entry for this hole to
      // ever disagree with.
      const res = await fetch(`/api/trips/${tripId}/rounds/${round.id}/shared-device-score`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holeNumber: hole.hole_number, grossScore: paperNoReturn ? null : Number(paperGross), isNoReturn: paperNoReturn }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `Couldn't save ${paperPlayerName}'s score. Please try again.`)
        setSaving(false)
        return
      }

      if (holeIdx < holes.length - 1) {
        setHoleIdx(i => i + 1)
        setMyGross(''); setMyNoReturn(false); setPaperGross(''); setPaperNoReturn(false)
      }
      setSaving(false)
    } catch {
      setError('Connection issue — please try again.')
      setSaving(false)
    }
  }

  if (showEducation) {
    return (
      <div style={{ minHeight: '100dvh', background: '#faf6ed', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '32px 24px' }}>
        <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 8 }}>📱</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: '#14532d', textAlign: 'center', marginBottom: 16 }}>
          You&apos;re scoring for two
        </div>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 14.5, color: '#374151', lineHeight: 1.7, textAlign: 'center', maxWidth: 380, margin: '0 auto 16px' }}>
          {paperPlayerName} is using a Paper Scorecard setup for this round.
        </p>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 14.5, color: '#374151', lineHeight: 1.7, textAlign: 'center', maxWidth: 380, margin: '0 auto 16px' }}>
          You&apos;ll enter:<br />
          <strong>Your score</strong><br />
          <strong>{paperPlayerName}&apos;s score</strong>
        </p>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#6b7280', lineHeight: 1.7, textAlign: 'center', maxWidth: 380, margin: '0 auto 24px' }}>
          Both scores entered on this phone will count as the official scores for this round.
          {paperPlayerName} does not need to enter or reconcile scores on another device.
        </p>
        <button
          onClick={() => { try { localStorage.setItem(eduKey, '1') } catch { /* ignore */ } setShowEducation(false) }}
          style={{ background: '#14532d', color: '#fff', border: 'none', borderRadius: 10, padding: '13px 0', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 15, cursor: 'pointer', maxWidth: 380, margin: '0 auto', width: '100%' }}
        >
          Start Scoring
        </button>
      </div>
    )
  }

  if (!holesLoaded) return null
  if (!hole) return <div style={{ padding: 40, textAlign: 'center', fontFamily: 'var(--font-body)', color: '#6b7280' }}>No holes found for this round.</div>

  return (
    <div style={{ minHeight: '100dvh', background: '#faf9f6', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: 'linear-gradient(170deg, #0a1f10 0%, #0f2d1a 60%, #0e2516 100%)', padding: '14px 20px', color: '#fdf3d9' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}>Hole {hole.hole_number}</div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, opacity: 0.8 }}>Par {hole.par} · SI {hole.stroke_index}</div>
      </div>

      <div style={{ padding: 16 }}>
        {/* Item 3 — "MY SCORE" card, unchanged in spirit from the
            existing digital scoring cards elsewhere in this app. */}
        <div style={{ background: '#fff', border: '1px solid #eceae3', borderRadius: 12, padding: 14, marginBottom: 12 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 800, color: '#7a7260', letterSpacing: 0.5, marginBottom: 8 }}>MY SCORE</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="number" inputMode="numeric" min="1" max="20" value={myGross} disabled={myNoReturn}
              onChange={e => setMyGross(e.target.value)} placeholder="—"
              style={{ width: 64, padding: '10px 6px', borderRadius: 8, border: '1px solid #d1d5db', fontFamily: 'var(--font-body)', fontSize: 20, textAlign: 'center', background: myNoReturn ? '#f3f4f6' : '#fff' }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260' }}>
              <input type="checkbox" checked={myNoReturn} onChange={e => { setMyNoReturn(e.target.checked); setMyGross('') }} /> No return
            </label>
            <div style={{ marginLeft: 'auto', fontFamily: 'var(--font-body)', fontWeight: 700, color: '#14532d' }}>{myPts()} pts</div>
          </div>
        </div>

        {/* Item 3 — "SCORING FOR — [Name] / ✏️ Paper Player." Explicitly
            NOT "Your Playing Partner," per the brief's own instruction —
            that label implies Mick is independently entering/checking
            Alex's score, which is exactly the wrong implication here. */}
        <div style={{ background: '#fdf3d9', border: '1.5px solid #e8c96a', borderRadius: 12, padding: 14 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 800, color: '#a1791f', letterSpacing: 0.5, marginBottom: 2 }}>SCORING FOR</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: '#14532d', marginBottom: 8 }}>
            {paperPlayerName} <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: '#a1791f' }}>✏️ Paper Player</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="number" inputMode="numeric" min="1" max="20" value={paperGross} disabled={paperNoReturn}
              onChange={e => setPaperGross(e.target.value)} placeholder="—"
              style={{ width: 64, padding: '10px 6px', borderRadius: 8, border: '1px solid #d1d5db', fontFamily: 'var(--font-body)', fontSize: 20, textAlign: 'center', background: paperNoReturn ? '#f3f4f6' : '#fff' }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260' }}>
              <input type="checkbox" checked={paperNoReturn} onChange={e => { setPaperNoReturn(e.target.checked); setPaperGross('') }} /> No return
            </label>
            <div style={{ marginLeft: 'auto', fontFamily: 'var(--font-body)', fontWeight: 700, color: '#14532d' }}>{paperPts()} pts</div>
          </div>
        </div>

        {error && <p style={{ color: '#dc2626', fontSize: 12.5, marginTop: 10, fontFamily: 'var(--font-body)' }}>{error}</p>}

        <button
          onClick={() => void confirmHole()}
          disabled={!canConfirm || saving}
          style={{
            width: '100%', marginTop: 16, padding: 13, borderRadius: 10, background: '#14532d', color: '#fff', border: 'none',
            fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14.5, cursor: canConfirm ? 'pointer' : 'default',
            opacity: (!canConfirm || saving) ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : holeIdx < holes.length - 1 ? 'Confirm & Next Hole →' : 'Confirm Final Hole'}
        </button>
      </div>
    </div>
  )
}
