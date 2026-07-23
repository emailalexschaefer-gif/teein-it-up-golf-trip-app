'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { calculateStableford } from '@/lib/scoring/stableford'
import { getHandicapStrokesForHole } from '@/lib/scoring/strokeAllocation'
import { compareCaptures, COMPARISON_LABEL, type ComparisonStatus, type CaptureValue } from '@/lib/scoring/comparison'
import { queueScoreEntry, getPendingCount, getQueuedEntriesForScorecards } from '@/lib/db/dexie'
import { syncScoreQueue, initSyncListeners } from '@/lib/db/sync'
import { useSyncStore, selectSyncLabel } from '@/store/syncStore'
import BrandLogo from '@/components/brand/BrandLogo'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Hole { id: string; hole_number: number; par: number; stroke_index: number }

interface ScoreEntryRow {
  hole_id: string; gross_score: number | null; stableford_pts: number | null
  is_no_return: boolean; capture_role: 'self' | 'marker'; entered_by: string
}

interface ScorecardFull {
  id: string
  player_id: string
  playing_handicap: number
  profiles: { id: string; full_name: string; avatar_url: string | null } | null
  score_entries: ScoreEntryRow[]
}

interface Round {
  id: string; name: string; status: string; holes: number
  scoring_format: string; score_capture_mode: 'self_and_marker' | 'group_scorer' | 'individual'
}

interface Props {
  tripId: string; tripName: string; round: Round
  myScorecard: ScorecardFull | null
  markedScorecard: ScorecardFull | null
  markedByName: string | null
  isOrganiser: boolean; currentUserId: string
  dataProblem?: boolean
}

type CaptureMap = Record<number, CaptureValue> // keyed by hole_number

function initialsOf(name: string): string { return name.slice(0, 2).toUpperCase() }

function splitByRole(entries: ScoreEntryRow[], holes: Hole[]): { self: CaptureMap; marker: CaptureMap } {
  const holeNumberById = new Map(holes.map(h => [h.id, h.hole_number]))
  const self: CaptureMap = {}
  const marker: CaptureMap = {}
  for (const e of entries) {
    const holeNum = holeNumberById.get(e.hole_id)
    if (!holeNum) continue
    const target = e.capture_role === 'self' ? self : marker
    target[holeNum] = { grossScore: e.gross_score, pickedUp: e.is_no_return }
  }
  return { self, marker }
}

function statusColor(status: ComparisonStatus): string {
  switch (status) {
    case 'matched': return '#4ade80'
    case 'mismatch': return '#f87171'
    case 'pending_marker': case 'pending_self': return '#e8c96a'
    default: return 'rgba(255,255,255,0.35)'
  }
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function SelfMarkerScoreShell({
  tripId, tripName, round, myScorecard, markedScorecard, markedByName, isOrganiser, currentUserId, dataProblem,
}: Props) {
  // 'individual' mode has no marker concept at all — comparison status,
  // the marker card, and reconciliation only make sense in self_and_marker
  // mode. page.tsx already guarantees markedScorecard is null for
  // individual mode, but every marker-related branch below gates on this
  // flag explicitly too, so nothing here depends on that alone.
  const requiresMarker = round.score_capture_mode === 'self_and_marker'

  const [holes, setHoles] = useState<Hole[]>([])
  const [loadingHoles, setLoadingHoles] = useState(true)
  const [holeIdx, setHoleIdx] = useState(0)
  const [resumed, setResumed] = useState(false)
  const [showReconciliation, setShowReconciliation] = useState(false)

  // Four independent capture maps: my own self entries, the marker entries
  // made ON my card (by whoever marks me — read-only here), my partner's own
  // self entries (read-only reference), and the marker entries I make on my
  // partner's card (what I actively edit).
  const [mySelf, setMySelf] = useState<CaptureMap>({})
  const [myMarker, setMyMarker] = useState<CaptureMap>({}) // entered by markedByName, read-only
  const [partnerSelf, setPartnerSelf] = useState<CaptureMap>({}) // entered by partner, read-only reference
  const [partnerMarker, setPartnerMarker] = useState<CaptureMap>({}) // I edit this

  const [draftMyGross, setDraftMyGross] = useState<number | null>(null)
  const [draftMyPickedUp, setDraftMyPickedUp] = useState(false)
  const [draftPartnerGross, setDraftPartnerGross] = useState<number | null>(null)
  const [draftPartnerPickedUp, setDraftPartnerPickedUp] = useState(false)

  const [flash, setFlash] = useState(false)
  const confirmingRef = useRef(false)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const syncState = useSyncStore(s => s.syncState)
  const pendingCount = useSyncStore(s => s.pendingCount)
  const syncLabel = useSyncStore(selectSyncLabel)

  const swipeStartX = useRef<number | null>(null)
  const swipeStartY = useRef<number | null>(null)

  // ── Load holes ──────────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoadingHoles(true)
      try {
        const res = await fetch(`/api/trips/${tripId}/rounds/${round.id}/holes`)
        if (res.ok) setHoles((await res.json()).holes ?? [])
      } catch { /* ignore */ }
      setLoadingHoles(false)
    }
    void load()
  }, [tripId, round.id])

  // ── Hydrate from server props, then overlay unsynced local queue entries ───
  useEffect(() => {
    if (holes.length === 0 || !myScorecard) return
    let cancelled = false

    async function hydrate() {
      const mine = splitByRole(myScorecard!.score_entries ?? [], holes)
      const theirs = markedScorecard ? splitByRole(markedScorecard.score_entries ?? [], holes) : { self: {}, marker: {} }

      const scorecardIds = [myScorecard!.id, ...(markedScorecard ? [markedScorecard.id] : [])]
      const queued = await getQueuedEntriesForScorecards(scorecardIds)
      if (cancelled) return

      const holeNumberById = new Map(holes.map(h => [h.id, h.hole_number]))
      for (const entry of queued.values()) {
        const holeNum = holeNumberById.get(entry.holeId)
        if (!holeNum) continue
        const value: CaptureValue = { grossScore: entry.grossScore, pickedUp: entry.isNoReturn }
        if (entry.scorecardId === myScorecard!.id && entry.captureRole === 'self') mine.self[holeNum] = value
        else if (entry.scorecardId === myScorecard!.id && entry.captureRole === 'marker') mine.marker[holeNum] = value
        else if (markedScorecard && entry.scorecardId === markedScorecard.id && entry.captureRole === 'self') theirs.self[holeNum] = value
        else if (markedScorecard && entry.scorecardId === markedScorecard.id && entry.captureRole === 'marker') theirs.marker[holeNum] = value
      }

      setMySelf(mine.self)
      setMyMarker(mine.marker)
      setPartnerSelf(theirs.self)
      setPartnerMarker(theirs.marker)

      if (!resumed) {
        setResumed(true)
        // Resume at the first hole where either my own score or my marker
        // entry for my partner is missing — never reset to hole 1 blindly.
        let target = holes.length - 1
        for (let i = 0; i < holes.length; i++) {
          const hn = holes[i].hole_number
          const myDone = mine.self[hn] !== undefined
          const partnerDone = !requiresMarker || !markedScorecard || theirs.marker[hn] !== undefined
          if (!myDone || !partnerDone) { target = i; break }
        }
        setHoleIdx(target)
        if (target >= holes.length - 1) {
          const allDone = holes.every(h => mine.self[h.hole_number] && (!requiresMarker || !markedScorecard || theirs.marker[h.hole_number]))
          if (allDone && requiresMarker) setShowReconciliation(true)
        }
      }
    }
    void hydrate()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holes, myScorecard, markedScorecard])

  useEffect(() => {
    const cleanup = initSyncListeners()
    void getPendingCount().then(n => useSyncStore.getState().setPendingCount(n))
    return cleanup
  }, [])

  function showToast(msg: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }

  const hole = holes[holeIdx] ?? null
  const holeNum = hole?.hole_number ?? holeIdx + 1
  const par = hole?.par ?? 4
  const si = hole?.stroke_index ?? 1

  // Sync draft state whenever the hole changes (prefer already-saved value if present)
  useEffect(() => {
    const existingMine = mySelf[holeNum]
    setDraftMyGross(existingMine?.grossScore ?? null)
    setDraftMyPickedUp(existingMine?.pickedUp ?? false)
    const existingPartner = partnerMarker[holeNum]
    setDraftPartnerGross(existingPartner?.grossScore ?? null)
    setDraftPartnerPickedUp(existingPartner?.pickedUp ?? false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeNum])

  const myHcp = myScorecard?.playing_handicap ?? 0
  const partnerHcp = markedScorecard?.playing_handicap ?? 0
  const myStrokes = hole ? getHandicapStrokesForHole({ playingHandicap: myHcp, strokeIndex: si }) : 0
  const partnerStrokes = hole ? getHandicapStrokesForHole({ playingHandicap: partnerHcp, strokeIndex: si }) : 0

  const myPts = draftMyPickedUp ? 0 : (draftMyGross !== null ? calculateStableford({ grossScore: draftMyGross, par, strokeIndex: si, playingHandicap: myHcp }) : null)
  const partnerPts = draftPartnerPickedUp ? 0 : (draftPartnerGross !== null ? calculateStableford({ grossScore: draftPartnerGross, par, strokeIndex: si, playingHandicap: partnerHcp }) : null)

  const myComparison = requiresMarker ? compareCaptures(mySelf[holeNum] ?? null, myMarker[holeNum] ?? null) : null
  const partnerComparison = requiresMarker && markedScorecard ? compareCaptures(partnerSelf[holeNum] ?? null, partnerMarker[holeNum] ?? null) : null

  const myRunningTotal = holes.reduce((sum, h) => {
    const c = mySelf[h.hole_number]
    if (!c || (c.grossScore === null && !c.pickedUp)) return sum
    if (c.pickedUp) return sum
    return sum + calculateStableford({ grossScore: c.grossScore!, par: h.par, strokeIndex: h.stroke_index, playingHandicap: myHcp })
  }, 0)

  function pick(which: 'mine' | 'partner', delta: number) {
    if (which === 'mine') {
      setDraftMyGross(g => Math.max(0, Math.min(15, (g ?? 0) + delta)) || null)
      setDraftMyPickedUp(false)
    } else {
      setDraftPartnerGross(g => Math.max(0, Math.min(15, (g ?? 0) + delta)) || null)
      setDraftPartnerPickedUp(false)
    }
  }
  function pickPar(which: 'mine' | 'partner') {
    if (which === 'mine') { setDraftMyGross(par); setDraftMyPickedUp(false) }
    else { setDraftPartnerGross(par); setDraftPartnerPickedUp(false) }
  }
  function togglePickUp(which: 'mine' | 'partner') {
    if (which === 'mine') { setDraftMyPickedUp(p => !p); setDraftMyGross(null) }
    else { setDraftPartnerGross(null); setDraftPartnerPickedUp(p => !p) }
  }

  const canConfirm = (draftMyGross !== null || draftMyPickedUp)
    && (!requiresMarker || !markedScorecard || draftPartnerGross !== null || draftPartnerPickedUp)

  async function confirmScore() {
    if (!canConfirm || !hole || !myScorecard || confirmingRef.current) return
    confirmingRef.current = true
    setFlash(true)

    const myValue: CaptureValue = { grossScore: draftMyPickedUp ? null : draftMyGross, pickedUp: draftMyPickedUp }
    setMySelf(prev => ({ ...prev, [holeNum]: myValue }))
    if (requiresMarker && markedScorecard) {
      const partnerValue: CaptureValue = { grossScore: draftPartnerPickedUp ? null : draftPartnerGross, pickedUp: draftPartnerPickedUp }
      setPartnerMarker(prev => ({ ...prev, [holeNum]: partnerValue }))
    }

    const isLastHole = holeIdx >= holes.length - 1
    setTimeout(() => {
      if (!isLastHole) {
        setHoleIdx(i => i + 1)
      } else if (requiresMarker) {
        // Individual mode has no comparison/reconciliation requirement at
        // all — there's nothing to reconcile with a single capture per
        // hole, so just stay on the completed final hole.
        setShowReconciliation(true)
      }
      confirmingRef.current = false
      setFlash(false)
    }, 480)

    try {
      await queueScoreEntry({
        scorecardId: myScorecard.id, holeId: hole.id, captureRole: 'self',
        grossScore: myValue.grossScore, isNoReturn: myValue.pickedUp,
        enteredAt: new Date().toISOString(),
      })
      if (requiresMarker && markedScorecard) {
        await queueScoreEntry({
          scorecardId: markedScorecard.id, holeId: hole.id, captureRole: 'marker',
          grossScore: draftPartnerPickedUp ? null : draftPartnerGross, isNoReturn: draftPartnerPickedUp,
          enteredAt: new Date().toISOString(),
        })
      }
      useSyncStore.getState().setPendingCount(await getPendingCount())
      void syncScoreQueue()
    } catch {
      showToast('Saved locally — will sync when online')
    }
  }

  function onTouchStart(e: React.TouchEvent) { swipeStartX.current = e.touches[0].clientX; swipeStartY.current = e.touches[0].clientY }
  function onTouchEnd(e: React.TouchEvent) {
    if (swipeStartX.current === null || swipeStartY.current === null) return
    const dx = e.changedTouches[0].clientX - swipeStartX.current
    const dy = e.changedTouches[0].clientY - swipeStartY.current
    swipeStartX.current = null; swipeStartY.current = null
    if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx) * 0.8) return
    if (dx < 0 && holeIdx < holes.length - 1) setHoleIdx(h => h + 1)
    if (dx > 0 && holeIdx > 0) setHoleIdx(h => h - 1)
  }

  const displaySyncLabel = pendingCount > 0 || syncState === 'syncing' ? `⏳ ${syncLabel}`
    : syncState === 'error' ? `⚠ ${syncLabel}` : syncState === 'synced' ? '✓ Saved' : ''

  // ── Empty / loading / data-problem states ──────────────────────────────────
  if (loadingHoles || holes.length === 0 || !myScorecard) {
    let message = 'Loading holes…'
    if (!loadingHoles && holes.length === 0) message = 'No holes found — run migration 004 and begin the round again.'
    else if (!loadingHoles && !myScorecard) {
      message = dataProblem && isOrganiser
        ? 'Your scorecard was not created correctly for this round. Return to the trip and regenerate the round setup.'
        : "Your scorecard hasn't been set up for this round yet. Ask the organiser to check the setup and try again."
    }
    return (
      <div style={{ minHeight: '100vh', background: '#0e1912', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', maxWidth: 320, padding: '0 20px' }}>
          <p style={{ fontSize: 32, marginBottom: 8 }}>⛳</p>
          <p style={{ fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.5)', fontSize: 13 }}>{message}</p>
          <Link href={`/trips/${tripId}`} style={{ display: 'block', marginTop: 16, fontFamily: 'var(--font-body)', fontSize: 12, color: '#e8c96a', textDecoration: 'none' }}>← Back to trip</Link>
        </div>
      </div>
    )
  }

  const myName = myScorecard.profiles?.full_name ?? 'You'
  const partnerName = markedScorecard?.profiles?.full_name ?? null

  // ── End-of-round reconciliation ─────────────────────────────────────────────
  if (showReconciliation) {
    const rows = holes.map(h => {
      const status = compareCaptures(mySelf[h.hole_number] ?? null, myMarker[h.hole_number] ?? null)
      return { hole: h, status, mine: mySelf[h.hole_number] ?? null, marker: myMarker[h.hole_number] ?? null }
    })
    const mismatches = rows.filter(r => r.status === 'mismatch')
    const pending = rows.filter(r => r.status === 'pending_marker' || r.status === 'pending_self' || r.status === 'not_started')
    const allClear = mismatches.length === 0 && pending.length === 0

    return (
      <div style={{ minHeight: '100vh', background: '#0e1912', padding: '20px 16px 60px' }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontFamily: 'var(--font-display)', color: '#e8c96a', fontSize: 20, fontWeight: 800 }}>Score Comparison</div>
          <div style={{ fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.6)', fontSize: 13, marginTop: 4 }}>
            {rows.length - mismatches.length - pending.length} holes matched · {mismatches.length} need review{pending.length > 0 ? ` · ${pending.length} pending` : ''}
          </div>
        </div>

        {mismatches.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            {mismatches.map(r => (
              <div key={r.hole.id} style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.4)', borderRadius: 12, padding: '12px 14px', marginBottom: 8 }}>
                <div style={{ fontFamily: 'var(--font-body)', color: '#f87171', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Hole {r.hole.hole_number}</div>
                <div style={{ display: 'flex', gap: 16, fontFamily: 'var(--font-body)', fontSize: 13, color: '#fff' }}>
                  <div>Your score: <strong>{r.mine?.pickedUp ? 'Pick-up' : r.mine?.grossScore ?? '—'}</strong></div>
                  <div>Marker score: <strong>{r.marker?.pickedUp ? 'Pick-up' : r.marker?.grossScore ?? '—'}</strong></div>
                </div>
                <button
                  onClick={() => { setHoleIdx(holes.indexOf(r.hole)); setShowReconciliation(false) }}
                  style={{ marginTop: 8, fontFamily: 'var(--font-body)', fontSize: 12, color: '#e8c96a', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  Edit your score →
                </button>
              </div>
            ))}
          </div>
        )}

        {pending.length > 0 && (
          <div style={{ marginBottom: 20, fontFamily: 'var(--font-body)', fontSize: 12, color: 'rgba(232,201,106,0.8)' }}>
            Waiting on marker entries for hole{pending.length > 1 ? 's' : ''}: {pending.map(r => r.hole.hole_number).join(', ')}.
            The round can&apos;t be finally submitted until every hole is matched.
          </div>
        )}

        {allClear && (
          <div style={{ textAlign: 'center', color: '#4ade80', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, marginBottom: 20 }}>
            ✓ All 18 holes matched — ready to submit.
          </div>
        )}

        <button
          onClick={() => setShowReconciliation(false)}
          style={{ width: '100%', padding: 12, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, color: '#fff', fontFamily: 'var(--font-body)', fontSize: 13, marginBottom: 10 }}
        >
          ← Back to scoring
        </button>
        <Link href={`/trips/${tripId}`} style={{ display: 'block', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 12, color: 'rgba(245,230,184,0.3)', textDecoration: 'none' }}>
          Return to trip overview
        </Link>
      </div>
    )
  }

  // ── Main hole-scoring view ──────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0e1912', minHeight: '100vh' }}>
      <div style={{ background: 'linear-gradient(135deg,#0f2d1c 0%,#172d1f 100%)', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '2px solid #c9a84c' }}>
        <Link href={`/trips/${tripId}`} style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, border: '1.5px solid #c9a84c', overflow: 'hidden' }}>
            <BrandLogo variant="icon" size={30} />
          </div>
          <span style={{ fontFamily: 'var(--font-display)', color: '#e8c96a', fontSize: 15, fontWeight: 800 }}>Teein&apos; It Up</span>
        </Link>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--font-body)', color: '#fff', fontWeight: 700, fontSize: 12 }}>{myName}</div>
          <div style={{ fontFamily: 'var(--font-body)', color: '#e8c96a', fontSize: 10, opacity: 0.7 }}>{tripName}</div>
        </div>
      </div>

      <div style={{ background: 'linear-gradient(90deg,#14532d,#166534)', padding: '7px 16px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <span style={{ fontSize: 13 }}>⛳</span>
        <span style={{ fontFamily: 'var(--font-body)', color: '#86efac', fontSize: 12, fontWeight: 700 }}>{round.name} — Hole {holeNum} of {holes.length}</span>
        {displaySyncLabel && <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-body)', fontSize: 10, color: 'rgba(134,239,172,0.8)' }}>{displaySyncLabel}</span>}
      </div>

      {toast && (
        <div style={{ position: 'fixed', top: 72, left: '50%', transform: 'translateX(-50%)', zIndex: 200, background: 'rgba(10,30,18,0.97)', border: '1px solid rgba(201,168,76,0.66)', borderRadius: 22, padding: '8px 18px' }}>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#e8c96a', fontWeight: 700 }}>● {toast}</span>
        </div>
      )}

      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 24px' }}>

        {markedByName && (
          <div style={{ textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 11, color: 'rgba(245,230,184,0.4)', marginBottom: 10 }}>
            Marked by {markedByName}
          </div>
        )}

        {/* ── Card 1: YOUR SCORE ─────────────────────────────────────────── */}
        <ScoreCard
          title="YOUR SCORE" name={myName} hcp={myHcp} par={par} si={si} strokes={myStrokes}
          gross={draftMyGross} pickedUp={draftMyPickedUp} pts={myPts}
          onPick={d => pick('mine', d)} onPar={() => pickPar('mine')} onTogglePickUp={() => togglePickUp('mine')}
          status={myComparison}
        />

        {/* ── Card 2: YOUR MARKER (the partner I mark) ──────────────────── */}
        {requiresMarker && markedScorecard && partnerName && (
          <ScoreCard
            title="YOUR MARKER" name={partnerName} hcp={partnerHcp} par={par} si={si} strokes={partnerStrokes}
            gross={draftPartnerGross} pickedUp={draftPartnerPickedUp} pts={partnerPts}
            onPick={d => pick('partner', d)} onPar={() => pickPar('partner')} onTogglePickUp={() => togglePickUp('partner')}
            status={partnerComparison}
          />
        )}

        <button
          onClick={confirmScore}
          disabled={!canConfirm || flash}
          style={{
            width: '100%', padding: 14, marginTop: 8,
            background: flash ? '#16a34a' : canConfirm ? 'linear-gradient(135deg,#2d7a52,#16a34a)' : 'rgba(255,255,255,0.08)',
            color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-body)',
            cursor: canConfirm ? 'pointer' : 'not-allowed',
          }}
        >
          {flash ? '✓ Saved!' : '✓ Confirm Score'}
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontFamily: 'var(--font-body)', fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
          <span>Swipe to change holes</span>
          <span style={{ color: '#e8c96a', fontWeight: 700 }}>{myRunningTotal} pts</span>
        </div>

        {requiresMarker && holes.length > 0 && holeIdx >= holes.length - 1 && (
          <button
            onClick={() => setShowReconciliation(true)}
            style={{ width: '100%', marginTop: 16, padding: 10, background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.4)', borderRadius: 10, color: '#e8c96a', fontFamily: 'var(--font-body)', fontSize: 13, cursor: 'pointer' }}
          >
            View Score Comparison →
          </button>
        )}

        {isOrganiser && (
          <Link href={`/trips/${tripId}/rounds/${round.id}/markers`} style={{ display: 'block', textAlign: 'center', marginTop: 20, fontFamily: 'var(--font-body)', fontSize: 12, color: 'rgba(245,230,184,0.4)', textDecoration: 'none' }}>
            Organiser: review marker assignments →
          </Link>
        )}
      </div>
    </div>
  )
}

// ── Score card sub-component ───────────────────────────────────────────────────

function ScoreCard({
  title, name, hcp, par, si, strokes, gross, pickedUp, pts, onPick, onPar, onTogglePickUp, status,
}: {
  title: string; name: string; hcp: number; par: number; si: number; strokes: number
  gross: number | null; pickedUp: boolean; pts: number | null
  onPick: (delta: number) => void; onPar: () => void; onTogglePickUp: () => void
  status: ComparisonStatus | null
}) {
  return (
    <div style={{ borderRadius: 14, background: '#161f19', border: '1.5px solid rgba(255,255,255,0.07)', marginBottom: 12, overflow: 'hidden' }}>
      <div style={{ background: 'linear-gradient(90deg,#0f2d1c,#1a3828)', padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, color: '#c9a84c', letterSpacing: 0.8 }}>{title}</div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, color: '#fff' }}>{name} <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 500, fontSize: 12 }}>(HC {hcp})</span></div>
        </div>
        {status && (
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, color: statusColor(status), textAlign: 'right' }}>
            {COMPARISON_LABEL[status]}
          </div>
        )}
      </div>

      <div style={{ padding: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <button onClick={() => onPick(-1)} style={{ width: 54, height: 54, borderRadius: 12, background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', fontSize: 24 }}>−</button>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-display)', color: pickedUp ? '#e8c96a' : gross === null ? 'rgba(255,255,255,0.25)' : '#fff', fontSize: 48, fontWeight: 800 }}>
              {pickedUp ? 'P' : gross ?? '0'}
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
              {pickedUp ? '0 Points (pick-up)' : pts !== null ? `${pts} Point${pts === 1 ? '' : 's'}` : 'Par ' + par + ' · SI ' + si}
            </div>
          </div>
          <button onClick={() => onPick(1)} style={{ width: 54, height: 54, borderRadius: 12, background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', fontSize: 24 }}>+</button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={onPar} style={{ flex: 1, padding: '7px 4px', borderRadius: 8, background: gross === par && !pickedUp ? 'rgba(74,158,114,0.25)' : 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', fontFamily: 'var(--font-body)', fontSize: 11, color: gross === par && !pickedUp ? '#4ade80' : 'rgba(255,255,255,0.6)' }}>
            PAR {par}
          </button>
          <div style={{ flex: 1, textAlign: 'center', padding: '7px 4px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>SHOTS</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: '#fff', fontWeight: 700 }}>{strokes}</div>
          </div>
          <button onClick={onTogglePickUp} style={{ flex: 1, padding: '7px 4px', borderRadius: 8, background: pickedUp ? 'rgba(232,201,106,0.25)' : 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', fontFamily: 'var(--font-body)', fontSize: 11, color: pickedUp ? '#e8c96a' : 'rgba(255,255,255,0.6)' }}>
            PICK UP
          </button>
        </div>
      </div>
    </div>
  )
}
