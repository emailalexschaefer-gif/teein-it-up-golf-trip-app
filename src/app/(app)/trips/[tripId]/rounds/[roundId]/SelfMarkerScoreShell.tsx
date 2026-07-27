'use client'

import React, { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { calculateStableford } from '@/lib/scoring/stableford'
import { getHandicapStrokesForHole } from '@/lib/scoring/strokeAllocation'
import { compareCaptures, COMPARISON_LABEL, type ComparisonStatus, type CaptureValue } from '@/lib/scoring/comparison'
import { queueScoreEntry, getPendingCount, getQueuedEntriesForScorecards } from '@/lib/db/dexie'
import { syncScoreQueue, initSyncListeners } from '@/lib/db/sync'
import { useSyncStore, selectSyncLabel } from '@/store/syncStore'

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
  isOrganiser: boolean
  dataProblem?: boolean
}

type CaptureMap = Record<number, CaptureValue> // keyed by hole_number

interface LiveScores {
  round: { id: string; status: string }
  myScorecard: ScorecardFull | null
  markedScorecard: ScorecardFull | null
  markedByName: string | null
}

async function fetchLiveScores(tripId: string, roundId: string): Promise<LiveScores> {
  const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/my-scores`)
  if (!res.ok) throw new Error('Failed to refresh scores')
  return res.json()
}

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
    case 'matched': return '#16a34a'
    case 'mismatch': return '#dc2626'
    case 'pending_marker': case 'pending_self': return '#a1791f'
    default: return '#9ca3af'
  }
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function SelfMarkerScoreShell({
  tripId, round, myScorecard, markedScorecard, markedByName, isOrganiser, dataProblem,
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

  // ── Live refresh ────────────────────────────────────────────────────────────
  // Root cause of the stale-data issue: this component used to hydrate its
  // capture maps ONCE from server-provided props and never again, so a
  // marker's submission or a reconciliation update on the other person's
  // device never appeared until this component fully remounted (leaving the
  // round and coming back). This query re-fetches the same data the server
  // resolves on first load, seeded with that same data via `initialData` so
  // there's no loading flash, then keeps it fresh via polling + window-focus
  // + reconnect — all without touching holeIdx or any in-progress draft.
  const { data: liveData, isFetching: isRefreshingScores } = useQuery<LiveScores>({
    queryKey: ['round-my-scores', tripId, round.id],
    queryFn: () => fetchLiveScores(tripId, round.id),
    initialData: {
      round: { id: round.id, status: round.status },
      myScorecard, markedScorecard, markedByName,
    },
    staleTime: 0, // always eligible for a window-focus/reconnect refetch
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    // Poll only while there's actually something to wait on. Stops
    // automatically once the round is no longer active, or once every hole
    // is fully reconciled (my own entry +, in self_and_marker mode, my
    // marker entry for my partner) — re-evaluated after every fetch.
    refetchInterval: (query) => {
      const d = query.state.data
      if (!d || d.round.status !== 'active' || holes.length === 0) return false
      const mine = splitByRole(d.myScorecard?.score_entries ?? [], holes)
      const theirsMarker = d.markedScorecard ? splitByRole(d.markedScorecard.score_entries ?? [], holes).marker : {}
      const allDone = holes.every(h =>
        mine.self[h.hole_number] !== undefined &&
        (!requiresMarker || !d.markedScorecard || theirsMarker[h.hole_number] !== undefined)
      )
      return allDone ? false : 7000
    },
  })

  // Everything below reads from these, not the raw props — the props are
  // only used to seed initialData above so there's no loading flash. This
  // is what makes a marker (re)assignment or partner data change show up
  // without a full remount, same as the score entries themselves.
  const currentMy = liveData.myScorecard
  const currentMarked = liveData.markedScorecard
  const currentMarkedByName = liveData.markedByName

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

  // ── Hydrate from live query data, then overlay unsynced local queue entries ─
  useEffect(() => {
    if (holes.length === 0 || !currentMy) return
    let cancelled = false

    async function hydrate() {
      const mine = splitByRole(currentMy!.score_entries ?? [], holes)
      const theirs = currentMarked ? splitByRole(currentMarked.score_entries ?? [], holes) : { self: {}, marker: {} }

      const scorecardIds = [currentMy!.id, ...(currentMarked ? [currentMarked.id] : [])]
      const queued = await getQueuedEntriesForScorecards(scorecardIds)
      if (cancelled) return

      const holeNumberById = new Map(holes.map(h => [h.id, h.hole_number]))
      for (const entry of queued.values()) {
        const holeNum = holeNumberById.get(entry.holeId)
        if (!holeNum) continue
        const value: CaptureValue = { grossScore: entry.grossScore, pickedUp: entry.isNoReturn }
        if (entry.scorecardId === currentMy!.id && entry.captureRole === 'self') mine.self[holeNum] = value
        else if (entry.scorecardId === currentMy!.id && entry.captureRole === 'marker') mine.marker[holeNum] = value
        else if (currentMarked && entry.scorecardId === currentMarked.id && entry.captureRole === 'self') theirs.self[holeNum] = value
        else if (currentMarked && entry.scorecardId === currentMarked.id && entry.captureRole === 'marker') theirs.marker[holeNum] = value
      }

      // These four always reflect the latest live data — updating them on
      // every refetch (not just the first) is exactly what makes a marker's
      // submission or a reconciliation change appear automatically.
      setMySelf(mine.self)
      setMyMarker(mine.marker)
      setPartnerSelf(theirs.self)
      setPartnerMarker(theirs.marker)

      // Resume-position and reconciliation-panel logic only ever runs ONCE
      // (guarded by `resumed`) — subsequent refetches update the maps above
      // but deliberately never touch holeIdx or re-trigger this, so the
      // current hole and any in-progress draft are preserved across refreshes.
      if (!resumed) {
        setResumed(true)
        let target = holes.length - 1
        for (let i = 0; i < holes.length; i++) {
          const hn = holes[i].hole_number
          const myDone = mine.self[hn] !== undefined
          const partnerDone = !requiresMarker || !currentMarked || theirs.marker[hn] !== undefined
          if (!myDone || !partnerDone) { target = i; break }
        }
        setHoleIdx(target)
        if (target >= holes.length - 1) {
          const allDone = holes.every(h => mine.self[h.hole_number] && (!requiresMarker || !currentMarked || theirs.marker[h.hole_number]))
          if (allDone && requiresMarker) setShowReconciliation(true)
        }
      }
    }
    void hydrate()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holes, liveData])

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

  const myHcp = currentMy?.playing_handicap ?? 0
  const partnerHcp = currentMarked?.playing_handicap ?? 0
  const myStrokes = hole ? getHandicapStrokesForHole({ playingHandicap: myHcp, strokeIndex: si }) : 0
  const partnerStrokes = hole ? getHandicapStrokesForHole({ playingHandicap: partnerHcp, strokeIndex: si }) : 0

  const myPts = draftMyPickedUp ? 0 : (draftMyGross !== null ? calculateStableford({ grossScore: draftMyGross, par, strokeIndex: si, playingHandicap: myHcp }) : null)
  const partnerPts = draftPartnerPickedUp ? 0 : (draftPartnerGross !== null ? calculateStableford({ grossScore: draftPartnerGross, par, strokeIndex: si, playingHandicap: partnerHcp }) : null)

  const myComparison = requiresMarker ? compareCaptures(mySelf[holeNum] ?? null, myMarker[holeNum] ?? null) : null
  const partnerComparison = requiresMarker && currentMarked ? compareCaptures(partnerSelf[holeNum] ?? null, partnerMarker[holeNum] ?? null) : null

  const myRunningTotal = holes.reduce((sum, h) => {
    const c = mySelf[h.hole_number]
    if (!c || (c.grossScore === null && !c.pickedUp)) return sum
    if (c.pickedUp) return sum
    return sum + calculateStableford({ grossScore: c.grossScore!, par: h.par, strokeIndex: h.stroke_index, playingHandicap: myHcp })
  }, 0)

  // Same calculation, but for the partner's own card — uses the partner's
  // own captures and their own handicap, not the current user's. Without
  // this, the YOUR MARKER card would show (or risk showing) the wrong
  // player's total if their handicaps differ.
  const partnerRunningTotal = holes.reduce((sum, h) => {
    const c = partnerSelf[h.hole_number]
    if (!c || (c.grossScore === null && !c.pickedUp)) return sum
    if (c.pickedUp) return sum
    return sum + calculateStableford({ grossScore: c.grossScore!, par: h.par, strokeIndex: h.stroke_index, playingHandicap: partnerHcp })
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
    && (!requiresMarker || !currentMarked || draftPartnerGross !== null || draftPartnerPickedUp)

  async function confirmScore() {
    if (!canConfirm || !hole || !currentMy || confirmingRef.current) return
    confirmingRef.current = true
    setFlash(true)

    const myValue: CaptureValue = { grossScore: draftMyPickedUp ? null : draftMyGross, pickedUp: draftMyPickedUp }
    setMySelf(prev => ({ ...prev, [holeNum]: myValue }))
    if (requiresMarker && currentMarked) {
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
        scorecardId: currentMy.id, holeId: hole.id, captureRole: 'self',
        grossScore: myValue.grossScore, isNoReturn: myValue.pickedUp,
        enteredAt: new Date().toISOString(),
      })
      if (requiresMarker && currentMarked) {
        await queueScoreEntry({
          scorecardId: currentMarked.id, holeId: hole.id, captureRole: 'marker',
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
      <div style={{ minHeight: '100vh', background: '#faf9f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', maxWidth: 320, padding: '0 20px' }}>
          <p style={{ fontSize: 32, marginBottom: 8 }}>⛳</p>
          <p style={{ fontFamily: 'var(--font-body)', color: '#6b7280', fontSize: 13 }}>{message}</p>
          <Link href={`/trips/${tripId}`} style={{ display: 'block', marginTop: 16, fontFamily: 'var(--font-body)', fontSize: 12, color: '#14532d', fontWeight: 700, textDecoration: 'none' }}>← Back to trip</Link>
        </div>
      </div>
    )
  }

  const myName = currentMy?.profiles?.full_name ?? 'You'
  const partnerName = currentMarked?.profiles?.full_name ?? null

  // ── End-of-round reconciliation ─────────────────────────────────────────────
  if (showReconciliation) {
    const PENDING: ComparisonStatus[] = ['pending_marker', 'pending_self', 'not_started']

    const rows = holes.map(h => {
      const mineStatus = compareCaptures(mySelf[h.hole_number] ?? null, myMarker[h.hole_number] ?? null)
      // Only meaningful when there's actually a partner card to mark —
      // requiresMarker is false in individual mode, and currentMarked can be
      // null even in self_and_marker mode if no partner is assigned yet.
      const partnerStatus = (requiresMarker && currentMarked)
        ? compareCaptures(partnerSelf[h.hole_number] ?? null, partnerMarker[h.hole_number] ?? null)
        : null
      return {
        hole: h,
        mineStatus, mine: mySelf[h.hole_number] ?? null, myMarkerVal: myMarker[h.hole_number] ?? null,
        partnerStatus, partnerSelfVal: partnerSelf[h.hole_number] ?? null, partnerMarkerVal: partnerMarker[h.hole_number] ?? null,
      }
    })

    // A hole needs review if EITHER pairing mismatches — this is the fix.
    // Previously only mineStatus fed into this list, so a mismatch that only
    // showed up on the partner's card (exactly what happens when the person
    // you're marking changes their own score) was invisible here even
    // though the scoring screen's "YOUR MARKER" badge already showed it.
    const mismatches = rows.filter(r => r.mineStatus === 'mismatch' || r.partnerStatus === 'mismatch')
    const pending = rows.filter(r =>
      r.mineStatus !== 'mismatch' && r.partnerStatus !== 'mismatch' &&
      (PENDING.includes(r.mineStatus) || (r.partnerStatus !== null && PENDING.includes(r.partnerStatus)))
    )
    const allClear = mismatches.length === 0 && pending.length === 0

    return (
      <div style={{ minHeight: '100vh', background: '#faf9f6', padding: '20px 16px 60px' }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 20, fontWeight: 800 }}>Score Comparison</div>
          <div style={{ fontFamily: 'var(--font-body)', color: '#6b7280', fontSize: 13, marginTop: 4 }}>
            {rows.length - mismatches.length - pending.length} holes matched · {mismatches.length} need review{pending.length > 0 ? ` · ${pending.length} pending` : ''}
          </div>
        </div>

        {mismatches.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            {mismatches.map(r => (
              <div key={r.hole.id} style={{ background: '#ffffff', border: '1px solid #fecaca', boxShadow: '0 2px 10px rgba(0,0,0,0.05)', borderRadius: 14, padding: '12px 14px', marginBottom: 8 }}>
                <div style={{ fontFamily: 'var(--font-body)', color: '#dc2626', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Hole {r.hole.hole_number}</div>

                {r.mineStatus === 'mismatch' && (
                  <div style={{ marginBottom: r.partnerStatus === 'mismatch' ? 10 : 0 }}>
                    <div style={{ display: 'flex', gap: 16, fontFamily: 'var(--font-body)', fontSize: 13, color: '#14532d' }}>
                      <div>Your score: <strong>{r.mine?.pickedUp ? 'Pick-up' : r.mine?.grossScore ?? '—'}</strong></div>
                      <div>Marker score: <strong>{r.myMarkerVal?.pickedUp ? 'Pick-up' : r.myMarkerVal?.grossScore ?? '—'}</strong></div>
                    </div>
                    <button
                      onClick={() => { setHoleIdx(holes.indexOf(r.hole)); setShowReconciliation(false) }}
                      style={{ marginTop: 6, fontFamily: 'var(--font-body)', fontSize: 12, color: '#c9a84c', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      Edit your score →
                    </button>
                  </div>
                )}

                {r.partnerStatus === 'mismatch' && (
                  <div>
                    <div style={{ display: 'flex', gap: 16, fontFamily: 'var(--font-body)', fontSize: 13, color: '#14532d' }}>
                      <div>{partnerName ?? 'Partner'}&apos;s score: <strong>{r.partnerSelfVal?.pickedUp ? 'Pick-up' : r.partnerSelfVal?.grossScore ?? '—'}</strong></div>
                      <div>Your marker entry: <strong>{r.partnerMarkerVal?.pickedUp ? 'Pick-up' : r.partnerMarkerVal?.grossScore ?? '—'}</strong></div>
                    </div>
                    <button
                      onClick={() => { setHoleIdx(holes.indexOf(r.hole)); setShowReconciliation(false) }}
                      style={{ marginTop: 6, fontFamily: 'var(--font-body)', fontSize: 12, color: '#c9a84c', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      Edit marker entry →
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {pending.length > 0 && (
          <div style={{ marginBottom: 20, fontFamily: 'var(--font-body)', fontSize: 12, color: '#a16207', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: '10px 14px' }}>
            Waiting on marker entries for hole{pending.length > 1 ? 's' : ''}: {pending.map(r => r.hole.hole_number).join(', ')}.
            The round can&apos;t be finally submitted until every hole is matched.
          </div>
        )}

        {allClear && (
          <div style={{ textAlign: 'center', color: '#16a34a', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, marginBottom: 20 }}>
            ✓ All 18 holes matched — ready to submit.
          </div>
        )}

        <button
          onClick={() => setShowReconciliation(false)}
          style={{ width: '100%', padding: 12, background: '#ffffff', border: '1.5px solid #d1d5db', borderRadius: 10, color: '#14532d', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, marginBottom: 10 }}
        >
          ← Back to scoring
        </button>
        <Link href={`/trips/${tripId}`} style={{ display: 'block', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af', textDecoration: 'none' }}>
          Return to trip overview
        </Link>
      </div>
    )
  }

  // ── Main hole-scoring view ──────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#ffffff', minHeight: '100vh' }}>
      <div style={{ padding: '16px 16px 12px', borderBottom: '2px solid #c9a84c' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>🚩</span>
          <span style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 17, fontWeight: 800 }}>
            {round.name} — Hole {holeNum} of {holes.length}
          </span>
          {displaySyncLabel && <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-body)', fontSize: 10, color: '#6b7280' }}>{displaySyncLabel}</span>}
        </div>
      </div>

      {toast && (
        <div style={{ position: 'fixed', top: 72, left: '50%', transform: 'translateX(-50%)', zIndex: 200, background: 'rgba(10,30,18,0.97)', border: '1px solid rgba(201,168,76,0.66)', borderRadius: 22, padding: '8px 18px' }}>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#e8c96a', fontWeight: 700 }}>● {toast}</span>
        </div>
      )}

      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 24px', background: '#faf9f6' }}>

        {currentMarkedByName && (
          <div style={{ textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 11, color: '#6b7280', marginBottom: 10 }}>
            Marked by {currentMarkedByName}
          </div>
        )}

        {/* ── Card 1: YOUR SCORE ─────────────────────────────────────────── */}
        <ScoreCard
          title="YOUR SCORE" name={myName} hcp={myHcp} par={par} si={si} strokes={myStrokes} holeNum={holeNum}
          gross={draftMyGross} pickedUp={draftMyPickedUp} pts={myPts} runningTotal={myRunningTotal}
          onPick={d => pick('mine', d)} onPar={() => pickPar('mine')} onTogglePickUp={() => togglePickUp('mine')}
          status={myComparison}
        />

        {/* ── Card 2: YOUR MARKER (the partner I mark) ──────────────────── */}
        {requiresMarker && markedScorecard && partnerName && (
          <ScoreCard
            title="YOUR MARKER" name={partnerName} hcp={partnerHcp} par={par} si={si} strokes={partnerStrokes} holeNum={holeNum}
            gross={draftPartnerGross} pickedUp={draftPartnerPickedUp} pts={partnerPts} runningTotal={partnerRunningTotal}
            onPick={d => pick('partner', d)} onPar={() => pickPar('partner')} onTogglePickUp={() => togglePickUp('partner')}
            status={partnerComparison}
          />
        )}

        <button
          onClick={confirmScore}
          disabled={!canConfirm || flash}
          style={{
            width: '100%', padding: 14, marginTop: 8,
            background: flash ? '#16a34a' : canConfirm ? 'linear-gradient(135deg,#2d7a52,#16a34a)' : '#e5e7eb',
            color: canConfirm || flash ? '#fff' : '#9ca3af', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-body)',
            cursor: canConfirm ? 'pointer' : 'not-allowed',
          }}
        >
          {flash ? '✓ Saved!' : '✓ Confirm Score'}
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af' }}>
          <span>Swipe to change holes</span>
          <span style={{ color: '#c9a84c', fontWeight: 700 }}>{myRunningTotal} pts</span>
        </div>

        {requiresMarker && holes.length > 0 && holeIdx >= holes.length - 1 && (
          <button
            onClick={() => setShowReconciliation(true)}
            style={{ width: '100%', marginTop: 16, padding: 10, background: '#ffffff', border: '1.5px solid #c9a84c', borderRadius: 10, color: '#a1791f', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            View Score Comparison →
          </button>
        )}

        {isOrganiser && (
          <Link href={`/trips/${tripId}/rounds/${round.id}/markers`} style={{ display: 'block', textAlign: 'center', marginTop: 20, fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af', textDecoration: 'none' }}>
            Organiser: review marker assignments →
          </Link>
        )}
      </div>
    </div>
  )
}

// ── Score card sub-component ───────────────────────────────────────────────────

function ScoreCard({
  title, name, hcp, par, si, strokes, holeNum, gross, pickedUp, pts, runningTotal, onPick, onPar, onTogglePickUp, status,
}: {
  title: string; name: string; hcp: number; par: number; si: number; strokes: number; holeNum: number
  gross: number | null; pickedUp: boolean; pts: number | null; runningTotal: number
  onPick: (delta: number) => void; onPar: () => void; onTogglePickUp: () => void
  status: ComparisonStatus | null
}) {
  return (
    <div style={{ borderRadius: 14, background: '#ffffff', border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', marginBottom: 12, overflow: 'hidden' }}>
      <div style={{ background: '#f7f6f1', padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #eceae3' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, color: '#a1791f', letterSpacing: 0.8 }}>{title}</div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, color: '#14532d' }}>{name} <span style={{ color: '#9ca3af', fontWeight: 500, fontSize: 12 }}>(HC {hcp})</span></div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, color: '#14532d', lineHeight: 1 }}>H{holeNum}</div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Par {par} · Index {si}</div>
          {status && (
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, color: statusColor(status), marginTop: 2 }}>
              {COMPARISON_LABEL[status]}
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <button onClick={() => onPick(-1)} style={{ width: 54, height: 54, borderRadius: 12, background: '#f7f6f1', border: '1.5px solid #e5e2d9', color: '#14532d', fontSize: 24 }}>−</button>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-display)', color: pickedUp ? '#c9a84c' : gross === null ? '#d1d5db' : '#14532d', fontSize: 48, fontWeight: 800 }}>
              {pickedUp ? 'P' : gross ?? '0'}
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#6b7280', marginTop: 2 }}>
              {pickedUp ? '0 Points (pick-up)' : pts !== null ? `${pts} Point${pts === 1 ? '' : 's'}` : 'Par ' + par + ' · SI ' + si}
            </div>
          </div>
          <button onClick={() => onPick(1)} style={{ width: 54, height: 54, borderRadius: 12, background: '#f7f6f1', border: '1.5px solid #e5e2d9', color: '#14532d', fontSize: 24 }}>+</button>
        </div>

        {/* Pick Up — relocated here from the permanent tile row below, per
            Darren's feedback. Same onTogglePickUp behavior, just moved: it's
            an action, not a status, so it reads better as a small secondary
            control near the score selector than as one-third of the
            PAR/SHOTS/TOTAL summary row. */}
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <button
            onClick={onTogglePickUp}
            style={{
              fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700,
              color: pickedUp ? '#a1791f' : '#9ca3af',
              background: pickedUp ? '#fdf3d9' : 'transparent',
              border: pickedUp ? '1px solid #e8c96a' : '1px solid #e5e2d9',
              borderRadius: 20, padding: '4px 14px', cursor: 'pointer',
            }}
          >
            {pickedUp ? '✕ Picked up — tap to undo' : 'Pick up'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={onPar} style={{ flex: 1, padding: '7px 4px', borderRadius: 8, background: gross === par && !pickedUp ? '#dcfce7' : '#f7f6f1', border: gross === par && !pickedUp ? '1px solid #86efac' : '1px solid #e5e2d9', textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, color: gross === par && !pickedUp ? '#16a34a' : '#9ca3af' }}>PAR</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800, color: gross === par && !pickedUp ? '#16a34a' : '#14532d' }}>{par}</div>
          </button>
          <div style={{ flex: 1, textAlign: 'center', padding: '7px 4px', borderRadius: 8, background: '#f7f6f1', border: '1px solid #e5e2d9' }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, color: '#9ca3af' }}>SHOTS</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: '#14532d', fontWeight: 700 }}>{strokes}</div>
          </div>
          <div style={{ flex: 1, textAlign: 'center', padding: '7px 4px', borderRadius: 8, background: '#fdf3d9', border: '1px solid #e8c96a' }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, color: '#a1791f' }}>TOTAL</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800, color: '#a1791f' }}>{runningTotal}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
