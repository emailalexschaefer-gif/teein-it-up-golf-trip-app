'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { calculateStableford } from '@/lib/scoring/stableford'
import { getHandicapStrokesForHole } from '@/lib/scoring/strokeAllocation'
import BrandLogo from '@/components/brand/BrandLogo'
import { queueScoreEntry, getPendingCount, getQueuedEntriesForScorecards } from '@/lib/db/dexie'
import { syncScoreQueue, initSyncListeners } from '@/lib/db/sync'
import { useSyncStore, selectSyncLabel } from '@/store/syncStore'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Hole { id: string; hole_number: number; par: number; stroke_index: number }

interface ScoreEntryRow { hole_id: string; gross_score: number; stableford_pts: number; is_no_return: boolean }

interface GroupScorecard {
  id: string
  player_id: string
  playing_handicap: number
  profiles: { id: string; full_name: string; avatar_url: string | null } | null
  score_entries: ScoreEntryRow[]
}

interface GroupInfo {
  groupId: string
  groupName: string
  teeTime: string | null
  scorecards: GroupScorecard[]
}

interface Round {
  id: string; name: string; status: string; holes: number
  scoring_format: string; course_name: string | null
  tee_time: string | null; play_date: string
}

interface Props {
  tripId: string; tripName: string; round: Round
  myScorecard: { id: string; playing_handicap: number; status: string } | null
  groupScorecards: GroupScorecard[]
  allGroups: GroupInfo[] | null
  initialGroupIdx?: number
  isOrganiser: boolean; currentUserId: string
  /** True only when the server has verified this is a genuine data problem
   * (a group with zero scorecards after the round has started), not a query
   * failure or a normal "not assigned yet" state. Drives which recovery
   * message is shown below. */
  dataProblem?: boolean
}

// ── Score flash labels ────────────────────────────────────────────────────────
function flashLabel(diff: number): string {
  if (diff <= -2) return 'Eagle! 🦅'
  if (diff === -1) return 'Birdie! 🔥'
  if (diff === 0)  return 'Par ✅'
  if (diff === 1)  return 'Bogey 👍'
  if (diff === 2)  return 'Double Bogey'
  return 'Triple+'
}

function ptsColor(pts: number): string {
  if (pts >= 4) return '#854d0e'
  if (pts === 3) return '#14532d'
  if (pts === 2) return '#1e3a5f'
  return '#7a7260'
}

function ptsBackground(pts: number): string {
  if (pts >= 4) return '#fef9c3'
  if (pts === 3) return '#dcfce7'
  if (pts === 2) return '#dbeafe'
  return 'rgba(255,255,255,0.08)'
}

function initialsOf(name: string): string {
  return name.slice(0, 2).toUpperCase()
}

// Per-scorecard, per-hole-number score/confirmed maps.
type ScoreMap = Record<string, Record<number, number | null>>
type ConfirmMap = Record<string, Record<number, boolean>>

// Find the first hole (by array index) where not every card in the group
// has a confirmed score, and the first not-yet-confirmed card on that hole.
// Used both for the initial "resume where I left off" position and whenever
// an organiser switches to a different playing group.
function findResumePosition(
  holes: Hole[], group: GroupScorecard[], confirmed: ConfirmMap
): { holeIdx: number; activeIdx: number } {
  if (holes.length === 0 || group.length === 0) return { holeIdx: 0, activeIdx: 0 }
  let targetHoleIdx = holes.length - 1
  for (let i = 0; i < holes.length; i++) {
    const h = holes[i]
    const allDone = group.every(c => confirmed[c.id]?.[h.hole_number])
    if (!allDone) { targetHoleIdx = i; break }
  }
  const holeNum = holes[targetHoleIdx].hole_number
  const firstUnconfirmed = group.findIndex(c => !confirmed[c.id]?.[holeNum])
  return { holeIdx: targetHoleIdx, activeIdx: firstUnconfirmed >= 0 ? firstUnconfirmed : 0 }
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ScoreSessionShell({
  tripId, tripName, round, groupScorecards, allGroups, initialGroupIdx, isOrganiser, currentUserId, dataProblem,
}: Props) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [holes, setHoles]               = useState<Hole[]>([])
  const [loadingHoles, setLoadingHoles] = useState(true)
  const [scores, setScores]             = useState<ScoreMap>({})
  const [confirmed, setConfirmed]       = useState<ConfirmMap>({})
  const [holeIdx, setHoleIdx]           = useState(0) // 0-indexed into holes array, shared across the group
  const [activeIdx, setActiveIdx]       = useState(0) // which group member's card is being entered
  const [activeGroupIdx, setActiveGroupIdx] = useState(initialGroupIdx ?? 0) // organiser only
  const [flash, setFlash]               = useState(false)
  const [flashMsg, setFlashMsg]         = useState('')
  const [flashPts, setFlashPts]         = useState(0)
  const [toast, setToast]               = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resumedRef = useRef(false)
  const confirmingRef = useRef(false)

  const syncState    = useSyncStore(s => s.syncState)
  const pendingCount = useSyncStore(s => s.pendingCount)
  const syncLabel    = useSyncStore(selectSyncLabel)

  // Swipe
  const swipeStartX = useRef<number | null>(null)
  const swipeStartY = useRef<number | null>(null)

  // The group currently being scored. Non-organisers only ever see their own
  // group (server already narrowed `groupScorecards` to it); organisers can
  // switch between every group via `allGroups`.
  const currentGroup: GroupScorecard[] = allGroups ? (allGroups[activeGroupIdx]?.scorecards ?? []) : groupScorecards

  // Every scorecard visible to this session, across every group — used only
  // for hydration, so switching groups never shows blank/stale data.
  const allVisibleScorecards: GroupScorecard[] = allGroups
    ? allGroups.flatMap(g => g.scorecards)
    : groupScorecards

  // Default the active card to the current user's own scorecard within the
  // active group (a playing organiser sees themselves; a non-playing
  // organiser or someone scoring a group they're not in falls back to the
  // first player).
  useEffect(() => {
    const idx = currentGroup.findIndex(c => c.player_id === currentUserId)
    if (idx >= 0) setActiveIdx(idx)
  }, [currentGroup, currentUserId])

  // ── Load holes ──────────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoadingHoles(true)
      try {
        const res = await fetch(`/api/trips/${tripId}/rounds/${round.id}/holes`)
        if (res.ok) {
          const data = await res.json()
          setHoles(data.holes ?? [])
        }
      } catch { /* ignore */ }
      setLoadingHoles(false)
    }
    void load()
  }, [tripId, round.id])

  // ── Hydrate scores/confirmed from server data, then overlay any unsynced
  // local edits still sitting in the offline queue ──────────────────────────
  // Server data reflects what has actually reached the database; the queue
  // reflects anything newer that hasn't synced yet. The queue always wins,
  // so a refresh never shows stale server data over a newer local edit, and
  // an unsynced score genuinely survives a refresh or app restart.
  useEffect(() => {
    if (holes.length === 0 || allVisibleScorecards.length === 0) return

    let cancelled = false
    async function hydrate() {
      const holeNumberById = new Map(holes.map(h => [h.id, h.hole_number]))
      const nextScores: ScoreMap = {}
      const nextConfirmed: ConfirmMap = {}

      for (const card of allVisibleScorecards) {
        nextScores[card.id] = {}
        nextConfirmed[card.id] = {}
        for (const entry of card.score_entries ?? []) {
          const holeNum = holeNumberById.get(entry.hole_id)
          if (!holeNum) continue
          nextScores[card.id][holeNum] = entry.gross_score
          nextConfirmed[card.id][holeNum] = true
        }
      }

      const queued = await getQueuedEntriesForScorecards(allVisibleScorecards.map(c => c.id))
      if (cancelled) return
      for (const entry of queued.values()) {
        if (entry.captureRole !== 'self') continue // this shell (group_scorer mode) has no marker concept
        const holeNum = holeNumberById.get(entry.holeId)
        if (!holeNum) continue
        nextScores[entry.scorecardId] = { ...nextScores[entry.scorecardId], [holeNum]: entry.grossScore }
        nextConfirmed[entry.scorecardId] = { ...nextConfirmed[entry.scorecardId], [holeNum]: true }
      }

      setScores(nextScores)
      setConfirmed(nextConfirmed)

      // Resume at the right spot — once only, on initial load.
      if (!resumedRef.current) {
        resumedRef.current = true
        const { holeIdx: rh, activeIdx: ra } = findResumePosition(holes, currentGroup, nextConfirmed)
        setHoleIdx(rh)
        setActiveIdx(ra)
      }
    }
    void hydrate()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holes, allVisibleScorecards])

  // ── Offline queue: register listeners once ─────────────────────────────────
  useEffect(() => {
    const cleanup = initSyncListeners()
    void getPendingCount().then(n => useSyncStore.getState().setPendingCount(n))
    return cleanup
  }, [])

  // ── Toast helper ──────────────────────────────────────────────────────────
  function showToast(msg: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }

  // ── Switch playing group (organiser only) — jumps to that group's own
  // resume point rather than keeping whatever hole the previous group was on.
  function switchGroup(idx: number) {
    if (!allGroups) return
    setActiveGroupIdx(idx)
    const grp = allGroups[idx]?.scorecards ?? []
    const { holeIdx: rh, activeIdx: ra } = findResumePosition(holes, grp, confirmed)
    setHoleIdx(rh)
    setActiveIdx(ra)
  }

  // ── Active card / hole data ────────────────────────────────────────────────
  const activeCard = currentGroup[activeIdx] ?? null
  const hole     = holes[holeIdx] ?? null
  const par      = hole?.par ?? 4
  const si       = hole?.stroke_index ?? 1
  const holeNum  = hole?.hole_number ?? holeIdx + 1
  const hcp      = activeCard?.playing_handicap ?? 0
  const gross    = activeCard ? (scores[activeCard.id]?.[holeNum] ?? null) : null
  const pts      = gross !== null ? calculateStableford({ grossScore: gross, par, strokeIndex: si, playingHandicap: hcp }) : null

  const cardConfirmedPts = useCallback((card: GroupScorecard) => {
    return holes.reduce((sum, h) => {
      if (!confirmed[card.id]?.[h.hole_number]) return sum
      const g = scores[card.id]?.[h.hole_number]
      if (!g) return sum
      return sum + calculateStableford({ grossScore: g, par: h.par, strokeIndex: h.stroke_index, playingHandicap: card.playing_handicap })
    }, 0)
  }, [holes, confirmed, scores])

  const cardHolesPlayed = useCallback((card: GroupScorecard) => {
    return holes.filter(h => confirmed[card.id]?.[h.hole_number]).length
  }, [holes, confirmed])

  const confirmedPts = activeCard ? cardConfirmedPts(activeCard) : 0
  const front9Pts = activeCard ? holes.slice(0, 9).reduce((sum, h) => {
    const g = scores[activeCard.id]?.[h.hole_number]
    if (!g || !confirmed[activeCard.id]?.[h.hole_number]) return sum
    return sum + calculateStableford({ grossScore: g, par: h.par, strokeIndex: h.stroke_index, playingHandicap: hcp })
  }, 0) : 0
  const back9Pts = activeCard ? holes.slice(9).reduce((sum, h) => {
    const g = scores[activeCard.id]?.[h.hole_number]
    if (!g || !confirmed[activeCard.id]?.[h.hole_number]) return sum
    return sum + calculateStableford({ grossScore: g, par: h.par, strokeIndex: h.stroke_index, playingHandicap: hcp })
  }, 0) : 0

  const strokesReceived = hole
    ? getHandicapStrokesForHole({ playingHandicap: hcp, strokeIndex: si })
    : 0

  // ── Score picker ──────────────────────────────────────────────────────────
  function pick(delta: number) {
    if (!hole || !activeCard) return
    const current = gross ?? 0
    const next = Math.max(0, Math.min(15, current + delta))
    setScores(prev => ({ ...prev, [activeCard.id]: { ...prev[activeCard.id], [holeNum]: next === 0 ? null : next } }))
  }

  function pickPar() {
    if (!hole || !activeCard) return
    setScores(prev => ({ ...prev, [activeCard.id]: { ...prev[activeCard.id], [holeNum]: par } }))
  }

  // ── Confirm score, then advance to the next group member / next hole ──────
  async function confirmScore() {
    if (gross === null || gross === 0 || !hole || !activeCard) return
    // Guards against a rapid double-tap firing two submissions before React
    // re-renders the disabled button state.
    if (confirmingRef.current) return
    confirmingRef.current = true

    const calcPts = calculateStableford({ grossScore: gross, par, strokeIndex: si, playingHandicap: hcp })
    const diff = gross - par
    const scoredCardId = activeCard.id
    const scoredHole = hole

    setFlash(true)
    setFlashPts(calcPts)
    setFlashMsg(flashLabel(diff))
    setConfirmed(prev => ({ ...prev, [scoredCardId]: { ...prev[scoredCardId], [holeNum]: true } }))

    // ── Group-scoring advance logic ──────────────────────────────────────────
    // Move to the next player in the group for this hole; once the last
    // player in the group has been scored, auto-advance to the next hole
    // and return to the first player. No menus, no extra taps.
    const isLastInGroup = activeIdx >= currentGroup.length - 1
    const nextHoleIdx = holeIdx + 1

    setTimeout(() => {
      if (!isLastInGroup) {
        setActiveIdx(activeIdx + 1)
      } else if (nextHoleIdx < holes.length) {
        setHoleIdx(nextHoleIdx)
        setActiveIdx(0)
      }
      // If it's the last player on hole 18: stay put — finishing the round
      // is a Sprint 5C/6 concern, not this screen's job.
    }, 580)
    setTimeout(() => {
      setFlash(false); setFlashPts(0); setFlashMsg('')
      confirmingRef.current = false
    }, 1400)

    // ── Save via the offline-first queue (Dexie), not a bare fetch ──────────
    // queueScoreEntry dedupes: if this same scorecard+hole already has an
    // unsynced entry queued, it's replaced in place (same operation id)
    // rather than creating a second queued write.
    try {
      const clientId = await queueScoreEntry({
        scorecardId: scoredCardId,
        holeId: scoredHole.id,
        captureRole: 'self',
        grossScore: gross,
        isNoReturn: false,
        enteredAt: new Date().toISOString(),
      })
      useSyncStore.getState().setPendingCount(await getPendingCount())
      void syncScoreQueue()
      void clientId
    } catch {
      showToast('Score saved locally — will sync when online')
    }
  }

  // ── Swipe navigation ──────────────────────────────────────────────────────
  function onTouchStart(e: React.TouchEvent) {
    swipeStartX.current = e.touches[0].clientX
    swipeStartY.current = e.touches[0].clientY
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (swipeStartX.current === null || swipeStartY.current === null) return
    const dx = e.changedTouches[0].clientX - swipeStartX.current
    const dy = e.changedTouches[0].clientY - swipeStartY.current
    swipeStartX.current = null
    swipeStartY.current = null
    if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx) * 0.8) return
    if (dx < 0 && holeIdx < holes.length - 1) setHoleIdx(h => h + 1)
    if (dx > 0 && holeIdx > 0) setHoleIdx(h => h - 1)
  }

  // ── Tile metadata for hole strip (reflects the ACTIVE player's card) ──────
  function tileMeta(h: Hole): { bg: string; label: string; sub: string; color?: string } {
    if (!activeCard) return { bg: 'rgba(255,255,255,0.07)', label: String(h.hole_number), sub: `p${h.par}` }
    const g = scores[activeCard.id]?.[h.hole_number]
    const isConf = confirmed[activeCard.id]?.[h.hole_number]
    if (!isConf || !g) {
      return { bg: 'rgba(255,255,255,0.07)', label: String(h.hole_number), sub: `p${h.par}` }
    }
    const p = calculateStableford({ grossScore: g, par: h.par, strokeIndex: h.stroke_index, playingHandicap: activeCard.playing_handicap })
    return { bg: ptsBackground(p), label: String(g), sub: `${p}pt`, color: ptsColor(p) }
  }

  const displaySyncLabel = pendingCount > 0 || syncState === 'syncing'
    ? `⏳ ${syncLabel}`
    : syncState === 'error' ? `⚠ ${syncLabel}`
    : syncState === 'synced' ? '✓ Saved'
    : ''

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loadingHoles || holes.length === 0 || !activeCard) {
    let message = 'Loading holes…'
    if (!loadingHoles && holes.length === 0) {
      message = 'No holes found — run migration 004 and begin the round again.'
    } else if (!loadingHoles && !activeCard) {
      if (dataProblem && isOrganiser) {
        message = 'Scorecards were not created correctly for this group. Return to the trip and regenerate the round setup.'
      } else if (dataProblem) {
        message = "Your scorecard hasn't been set up for this round yet. Ask the organiser to check the group setup and try again."
      } else {
        message = 'No scorecard found for this group.'
      }
    }
    return (
      <div style={{ minHeight: '100vh', background: '#0e1912', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', maxWidth: 320, padding: '0 20px' }}>
          <p style={{ fontSize: 32, marginBottom: 8 }}>⛳</p>
          <p style={{ fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.5)', fontSize: 13 }}>
            {message}
          </p>
          <Link href={`/trips/${tripId}`} style={{ display: 'block', marginTop: 16, fontFamily: 'var(--font-body)', fontSize: 12, color: '#e8c96a', textDecoration: 'none' }}>
            ← Back to trip
          </Link>
        </div>
      </div>
    )
  }

  const front9: Hole[] = holes.slice(0, 9)
  const back9: Hole[]  = holes.slice(9)
  const isBack9 = holeIdx >= 9
  const activeName = activeCard.profiles?.full_name ?? 'Player'

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0e1912', minHeight: '100vh', position: 'relative' }}>

      {/* ── App header ─────────────────────────────────────────────────────── */}
      <div style={{
        background: `linear-gradient(135deg,#0f2d1c 0%,#172d1f 100%)`,
        padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '2px solid #c9a84c', flexShrink: 0,
      }}>
        <Link href={`/trips/${tripId}`} style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, border: '1.5px solid #c9a84c', overflow: 'hidden', flexShrink: 0 }}>
            <BrandLogo variant="icon" size={30} />
          </div>
          <span style={{ fontFamily: 'var(--font-display)', color: '#e8c96a', fontSize: 15, fontWeight: 800 }}>
            Teein&apos; It Up
          </span>
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--font-body)', color: '#ffffff', fontWeight: 700, fontSize: 12 }}>{activeName}</div>
            <div style={{ fontFamily: 'var(--font-body)', color: '#e8c96a', fontSize: 10, opacity: 0.7 }}>{tripName}</div>
          </div>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'radial-gradient(#e8c96a,#c9a84c)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-body)', fontWeight: 900, color: '#0f2d1c', fontSize: 12 }}>
            {initialsOf(activeName)}
          </div>
          {isOrganiser && (
            <div style={{ background: 'rgba(201,168,76,0.18)', border: '1px solid #c9a84c', borderRadius: 16, padding: '3px 9px', fontFamily: 'var(--font-body)', color: '#e8c96a', fontSize: 10, fontWeight: 700 }}>ORGANISER</div>
          )}
        </div>
      </div>

      {/* ── Round status bar (no rankings — that's Sprint 5C) ─────────────── */}
      <div style={{ background: 'linear-gradient(90deg,#14532d,#166534)', padding: '7px 16px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
        <span style={{ fontSize: 13 }}>⛳</span>
        <span style={{ fontFamily: 'var(--font-body)', color: '#86efac', fontSize: 12, fontWeight: 700 }}>
          {round.name} — round in progress
        </span>
        {displaySyncLabel && (
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-body)', fontSize: 10, color: syncState === 'synced' ? '#86efac' : syncState === 'error' ? '#fca5a5' : 'rgba(134,239,172,0.5)' }}>
            {displaySyncLabel}
          </span>
        )}
      </div>

      {/* ── Toast ──────────────────────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: 'fixed', top: 72, left: '50%', transform: 'translateX(-50%)',
          zIndex: 200, pointerEvents: 'none',
          background: 'rgba(10,30,18,0.97)', border: '1px solid rgba(201,168,76,0.66)',
          borderRadius: 22, padding: '8px 18px', whiteSpace: 'nowrap',
          boxShadow: '0 4px 24px rgba(0,0,0,0.7)', maxWidth: '90vw',
        }}>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#e8c96a', fontWeight: 700 }}>● {toast}</span>
        </div>
      )}

      {/* ── Scrollable body ────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>

        {/* ── Organiser: playing-group switcher ────────────────────────────── */}
        {allGroups && allGroups.length > 1 && (
          <div style={{ padding: '10px 16px 0', flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700, letterSpacing: 1, color: 'rgba(245,230,184,0.4)', marginBottom: 6 }}>
              ORGANISER — SWITCH PLAYING GROUP
            </div>
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
              {allGroups.map((g, i) => (
                <button key={g.groupId} onClick={() => switchGroup(i)} style={{
                  flexShrink: 0, padding: '6px 12px', borderRadius: 20, cursor: 'pointer',
                  background: i === activeGroupIdx ? 'linear-gradient(135deg,#8a6d1f,#c9a84c)' : 'rgba(255,255,255,0.06)',
                  border: i === activeGroupIdx ? '1.5px solid #e8c96a' : '1px solid rgba(255,255,255,0.12)',
                  fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700,
                  color: i === activeGroupIdx ? '#0f2d1c' : 'rgba(255,255,255,0.7)',
                }}>
                  {g.groupName}{g.teeTime ? ` · ${g.teeTime}` : ''}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Playing-group switcher ─────────────────────────────────────── */}
        {currentGroup.length > 1 && (
          <div style={{ padding: '10px 16px 0', flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700, letterSpacing: 1, color: 'rgba(245,230,184,0.4)', marginBottom: 6 }}>
              PLAYING GROUP — TAP TO SCORE FOR
            </div>
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
              {currentGroup.map((c, i) => {
                const name = c.profiles?.full_name ?? 'Player'
                const isOn = i === activeIdx
                const done = confirmed[c.id]?.[holeNum]
                return (
                  <button key={c.id} onClick={() => setActiveIdx(i)} style={{
                    display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
                    padding: '6px 10px', borderRadius: 20, cursor: 'pointer',
                    background: isOn ? 'linear-gradient(135deg,#2d7a52,#16a34a)' : 'rgba(255,255,255,0.06)',
                    border: isOn ? '1.5px solid #e8c96a' : '1px solid rgba(255,255,255,0.12)',
                  }}>
                    <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'radial-gradient(#e8c96a,#c9a84c)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-body)', fontWeight: 900, color: '#0f2d1c', fontSize: 9 }}>
                      {initialsOf(name)}
                    </span>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: isOn ? '#fff' : 'rgba(255,255,255,0.7)' }}>
                      {name.split(' ')[0]}
                    </span>
                    {done && <span style={{ fontSize: 10, color: '#86efac' }}>✓</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Hole strip ──────────────────────────────────────────────────── */}
        <div style={{ padding: '10px 16px 6px', flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700, letterSpacing: 1, color: 'rgba(134,239,172,0.6)', marginBottom: 4 }}>
            {front9Pts > 0 ? `✓ FRONT 9 — ${front9Pts} PTS` : ''}
          </div>
          <div style={{ display: 'flex', gap: 3, overflowX: 'auto', marginBottom: 8 }}>
            {front9.map((h, i) => {
              const m = tileMeta(h)
              const isOn = i === holeIdx
              return (
                <div key={h.id} onClick={() => setHoleIdx(i)} style={{
                  minWidth: 32, height: 40, borderRadius: 6, flexShrink: 0, cursor: 'pointer',
                  background: isOn ? 'linear-gradient(160deg,#2d7a52,#1a4731)' : m.bg,
                  border: `1.5px solid ${isOn ? '#e8c96a' : 'rgba(255,255,255,0.11)'}`,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  transform: isOn ? 'scale(1.1)' : 'scale(1)', transition: 'transform 0.12s',
                  boxShadow: isOn ? '0 4px 14px rgba(45,122,82,0.5)' : undefined,
                }}>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: isOn ? '#fff' : (m.color ?? 'rgba(255,255,255,0.7)') }}>{m.label}</div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 8, fontWeight: 600, color: isOn ? '#e8c96a' : (m.color ?? 'rgba(255,255,255,0.45)') }}>{m.sub}</div>
                </div>
              )
            })}
          </div>

          {back9.length > 0 && (
            <>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700, letterSpacing: 1, color: 'rgba(255,255,255,0.35)', marginBottom: 4 }}>
                BACK 9 — {isBack9 ? 'ENTERING NOW' : 'COMING UP'}
              </div>
              <div style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingRight: 16, WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'] }}>
                {back9.map((h, i) => {
                  const realIdx = i + 9
                  const m = tileMeta(h)
                  const isOn = realIdx === holeIdx
                  return (
                    <div key={h.id} onClick={() => setHoleIdx(realIdx)} style={{
                      minWidth: 38, height: 50, borderRadius: 8, flexShrink: 0, cursor: 'pointer',
                      background: isOn ? 'linear-gradient(160deg,#2d7a52,#1a4731)' : m.bg,
                      border: `1.5px solid ${isOn ? '#e8c96a' : 'rgba(255,255,255,0.11)'}`,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      transform: isOn ? 'scale(1.1)' : 'scale(1)', transition: 'transform 0.12s',
                      boxShadow: isOn ? '0 4px 14px rgba(45,122,82,0.5)' : undefined,
                    }}>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: isOn ? '#fff' : (m.color ?? 'rgba(255,255,255,0.7)') }}>{m.label}</div>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: 9.5, fontWeight: 600, color: isOn ? '#e8c96a' : (m.color ?? 'rgba(255,255,255,0.45)') }}>{m.sub}</div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* ── Swipeable score entry card ─────────────────────────────────── */}
        <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} style={{ userSelect: 'none', WebkitUserSelect: 'none' as React.CSSProperties['WebkitUserSelect'] }}>
          <div style={{ margin: '0 16px 8px', borderRadius: 14, background: '#161f19', border: '1.5px solid rgba(255,255,255,0.07)', boxShadow: '0 6px 28px rgba(0,0,0,0.5)', flexShrink: 0, overflow: 'hidden', position: 'relative' }}>

            {flash && (
              <div style={{
                position: 'absolute', top: '36%', left: '50%', transform: 'translate(-50%,-50%)',
                zIndex: 20, pointerEvents: 'none',
                background: flashPts >= 3 ? 'rgba(14,122,52,0.95)' : flashPts === 2 ? 'rgba(28,90,165,0.92)' : 'rgba(60,60,60,0.88)',
                borderRadius: 14, padding: '10px 24px', textAlign: 'center',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)', minWidth: 160,
              }}>
                <div style={{ fontFamily: 'var(--font-display)', color: '#fff', fontSize: 20, fontWeight: 800, lineHeight: 1.2 }}>{flashMsg}</div>
                {flashPts > 0 && <div style={{ fontFamily: 'var(--font-body)', color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 3 }}>+{flashPts} Stableford pt{flashPts !== 1 ? 's' : ''}</div>}
              </div>
            )}

            <div style={{ background: `linear-gradient(90deg,#0f2d1c,#1a3828)`, padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'radial-gradient(#e8c96a,#c9a84c)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-body)', fontWeight: 900, color: '#0f2d1c', fontSize: 11 }}>
                  {initialsOf(activeName)}
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--font-body)', color: '#ffffff', fontWeight: 700, fontSize: 14 }}>{activeName}</div>
                  <div style={{ fontFamily: 'var(--font-body)', color: '#e8c96a', fontSize: 11, opacity: 0.7 }}>Daily HCP {hcp}</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'var(--font-display)', color: '#e8c96a', fontSize: 20, fontWeight: 800, lineHeight: 1 }}>H{holeNum}</div>
                <div style={{ fontFamily: 'var(--font-body)', color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>Par {par} · Index {si}</div>
              </div>
            </div>

            <div style={{ padding: '16px 16px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <button onClick={() => pick(-1)} style={{ width: 64, height: 64, borderRadius: 14, flexShrink: 0, background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                  <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 28, fontWeight: 300 }}>−</span>
                </button>
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontFamily: 'var(--font-display)', color: gross === null ? 'rgba(255,255,255,0.25)' : '#ffffff', fontSize: 64, fontWeight: 800, lineHeight: 1 }}>
                    {gross === null ? '0' : gross}
                  </div>
                  {pts !== null ? (
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, marginTop: 2, color: pts >= 3 ? '#4ade80' : pts === 2 ? '#93c5fd' : 'rgba(255,255,255,0.5)' }}>
                      {pts} {pts === 1 ? 'Point' : 'Points'}
                    </div>
                  ) : (
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>tap + to add shots · or tap PAR</div>
                  )}
                </div>
                <button onClick={() => pick(+1)} style={{ width: 64, height: 64, borderRadius: 14, flexShrink: 0, background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                  <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 28, fontWeight: 300 }}>+</span>
                </button>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10 }}>
                <button onClick={pickPar} style={{ flex: 1, textAlign: 'center', background: gross === par ? 'rgba(74,158,114,0.25)' : 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '7px 4px', border: gross === par ? '1px solid rgba(74,158,114,0.5)' : '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', transition: 'all 0.15s' }}>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 9.5, fontWeight: 700, color: gross === par ? '#4ade80' : 'rgba(255,255,255,0.4)', letterSpacing: 0.8, marginBottom: 3 }}>PAR</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, color: gross === par ? '#4ade80' : '#ffffff' }}>{par}</div>
                </button>
                <div style={{ flex: 1, textAlign: 'center', background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '7px 4px', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 9.5, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: 0.8, marginBottom: 3 }}>SHOTS</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, color: '#ffffff' }}>{strokesReceived}</div>
                </div>
                <div style={{ flex: 1, textAlign: 'center', background: 'rgba(201,168,76,0.08)', borderRadius: 8, padding: '7px 4px', border: '1px solid rgba(201,168,76,0.22)' }}>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 9.5, fontWeight: 700, color: '#c9a84c', letterSpacing: 0.8, marginBottom: 3 }}>TOTAL</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, color: '#e8c96a' }}>{confirmedPts}</div>
                </div>
              </div>
            </div>

            <div style={{ padding: '0 16px 14px' }}>
              <button
                onClick={confirmScore}
                disabled={gross === null || gross === 0 || flash}
                style={{
                  width: '100%', padding: 14,
                  background: flash ? '#16a34a' : (gross !== null && gross > 0) ? `linear-gradient(135deg,#2d7a52,#16a34a)` : 'rgba(255,255,255,0.08)',
                  color: '#ffffff', border: 'none', borderRadius: 10,
                  fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-body)',
                  cursor: (gross !== null && gross > 0) ? 'pointer' : 'not-allowed',
                  letterSpacing: 0.5, transition: 'background 0.2s',
                  boxShadow: gross !== null ? '0 4px 16px rgba(22,163,74,0.4)' : 'none',
                }}
              >
                {flash ? '✓ Saved!' : '✓ Confirm Score'}
              </button>
            </div>
          </div>

          <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'rgba(245,230,184,0.22)', textAlign: 'center', paddingTop: 4, paddingBottom: 2, letterSpacing: 0.3 }}>
            Swipe left/right to change holes
          </div>
        </div>

        {/* ── F9 / B9 totals ──────────────────────────────────────────────── */}
        <div style={{ padding: '4px 16px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'rgba(255,255,255,0.38)' }}>
            F9: <strong style={{ color: 'rgba(134,239,172,0.7)' }}>{front9Pts}</strong>{'  +  '}B9: <strong style={{ color: 'rgba(255,255,255,0.6)' }}>{back9Pts}</strong>
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: '#e8c96a', fontWeight: 800 }}>{confirmedPts} pts</div>
        </div>

        {/* ── Group progress (neutral — no rankings, that's Sprint 5C) ─────── */}
        {currentGroup.length > 1 && (
          <div style={{ margin: '6px 16px 20px', flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#c9a84c', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 }}>
              Group Progress
            </div>
            <div style={{ background: '#111a14', borderRadius: 12, border: '1px solid rgba(201,168,76,0.2)', overflow: 'hidden' }}>
              {currentGroup.map(c => {
                const name = c.profiles?.full_name ?? 'Player'
                const played = cardHolesPlayed(c)
                const total = cardConfirmedPts(c)
                const isMe = c.player_id === currentUserId
                return (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)', background: isMe ? 'rgba(201,168,76,0.09)' : 'transparent' }}>
                    <div style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 13.5, fontWeight: isMe ? 800 : 600, color: isMe ? '#e8c96a' : '#ffffff' }}>{name}</div>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: 'rgba(255,255,255,0.4)', marginRight: 10 }}>{played}/{holes.length} holes</div>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: isMe ? '#e8c96a' : 'rgba(255,255,255,0.68)' }}>{total}<span style={{ fontSize: 10, opacity: 0.5 }}> pts</span></div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <Link href={`/trips/${tripId}`} style={{ display: 'block', textAlign: 'center', marginBottom: 24, fontFamily: 'var(--font-body)', fontSize: 12, color: 'rgba(245,230,184,0.3)', textDecoration: 'none' }}>
          ← Return to trip overview
        </Link>

      </div>
    </div>
  )
}
