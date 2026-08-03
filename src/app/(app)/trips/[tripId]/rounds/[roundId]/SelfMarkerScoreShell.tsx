'use client'

import React, { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { calculateStableford } from '@/lib/scoring/stableford'
import { getHandicapStrokesForHole } from '@/lib/scoring/strokeAllocation'
import { compareCaptures, COMPARISON_LABEL, type ComparisonStatus, type CaptureValue } from '@/lib/scoring/comparison'
import { queueScoreEntry, getPendingCount, getQueuedEntriesForScorecards } from '@/lib/db/dexie'
import { syncScoreQueue, initSyncListeners } from '@/lib/db/sync'
import { useSyncStore, selectSyncLabel } from '@/store/syncStore'

// ── Types ──────────────────────────────────────────────────────────────────────

// Optional badge fields — deliberately NOT selected by the current holes
// query, and no such columns exist in the database yet (checked before
// adding this: migration 004 defines holes as just id/round_id/hole_
// number/par/stroke_index). These are always undefined today, which is
// exactly the point — the rendering below is real, working code that
// will activate automatically once real Powerplay/side-game metadata
// exists, rather than a fake badge shown regardless of data.
interface Hole {
  id: string; hole_number: number; par: number; stroke_index: number
  is_powerplay?: boolean
  side_game_type?: 'nearest_pin' | 'longest_drive' | 'straightest_drive' | null
}

const SIDE_GAME_BADGE: Record<string, { icon: string; label: string }> = {
  nearest_pin: { icon: '🎯', label: 'Nearest the Pin' },
  longest_drive: { icon: '💥', label: 'Longest Drive' },
  straightest_drive: { icon: '↗', label: 'Straightest Drive' },
}

function HoleBadges({ hole }: { hole: Hole }) {
  const badges: { icon: string; label: string }[] = []
  if (hole.is_powerplay) badges.push({ icon: '⚡', label: 'Powerplay' })
  if (hole.side_game_type && SIDE_GAME_BADGE[hole.side_game_type]) badges.push(SIDE_GAME_BADGE[hole.side_game_type])
  if (badges.length === 0) return null
  return (
    <div style={{ display: 'flex', gap: 5, marginTop: 3 }}>
      {badges.map(b => (
        <span key={b.label} style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, color: '#a1791f',
          background: '#fdf3d9', border: '1px solid #e8c96a', borderRadius: 10, padding: '2px 8px',
        }}>
          {b.icon} {b.label}
        </span>
      ))}
    </div>
  )
}

interface ScoreEntryRow {
  hole_id: string; gross_score: number | null; stableford_pts: number | null
  is_no_return: boolean; capture_role: 'self' | 'marker'; entered_by: string
}

interface ScorecardFull {
  id: string
  player_id: string
  playing_handicap: number
  status: string
  submitted_at: string | null
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

function SummaryRow({ r, statusIcon, onClick }: {
  r: { hole: Hole; status: string; gross: number | string | null; pts: number | null }
  statusIcon: { icon: string; color: string }
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center',
        padding: '6px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
        borderBottom: '1px solid #f3f4f1',
      }}
    >
      <span style={{ width: 56, fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#14532d' }}>{r.hole.hole_number}</span>
      <span style={{ width: 40, fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af', textAlign: 'center' }}>{r.hole.par}</span>
      <span style={{ width: 48, fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#14532d', textAlign: 'center' }}>{r.gross ?? '—'}</span>
      <span style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#a1791f', textAlign: 'center' }}>{r.pts ?? '—'}</span>
      <span style={{ width: 24, fontSize: 13, textAlign: 'right' }}>{statusIcon.icon}</span>
    </button>
  )
}

function SubtotalRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '5px 12px', background: '#f7f6f1', borderBottom: '1px solid #eceae3' }}>
      <span style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#6b7280', letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 800, color: '#14532d' }}>{value} pts</span>
    </div>
  )
}

function stripPtsColor(pts: number): string {
  if (pts >= 4) return '#854d0e'
  if (pts === 3) return '#14532d'
  if (pts === 2) return '#1e3a5f'
  return '#7a7260'
}

function stripPtsBackground(pts: number): string {
  if (pts >= 4) return '#fef9c3'
  if (pts === 3) return '#dcfce7'
  if (pts === 2) return '#dbeafe'
  return '#f3f4f6'
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
  const searchParams = useSearchParams()
  const appliedDeepLinkRef = useRef(false)

  // Deep-link support (Sprint 5H Priority 4/5): a "Review Now" link from
  // My HQ can pass ?hole=N to land directly on the affected hole instead
  // of always opening at Hole 1. Runs once, the first time `holes` is
  // populated — guarded so it never re-fires and overrides the golfer's
  // own subsequent navigation once they've started moving between holes.
  useEffect(() => {
    if (appliedDeepLinkRef.current || holes.length === 0) return
    appliedDeepLinkRef.current = true
    const targetHole = Number(searchParams?.get('hole'))
    if (targetHole) {
      const idx = holes.findIndex(h => h.hole_number === targetHole)
      if (idx >= 0) setHoleIdx(idx)
    }
  }, [holes, searchParams])

  // Reposition to the Scoring Anchor whenever (and only whenever) the
  // active hole changes. useEffect's dependency array is the actual
  // mechanism enforcing "only on hole change, never while editing/mid-
  // interaction" — score edits, toasts, sync-status ticks, and every
  // other state change in this component do not touch holeIdx, so they
  // cannot trigger this effect. The hasHydratedRef guard skips the very
  // first run (initial mount), so opening the page doesn't itself cause
  // an unwanted scroll/jump before the golfer has done anything.
  useEffect(() => {
    if (!hasHydratedRef.current) { hasHydratedRef.current = true; return }
    // Collapsed mode: the workspace is already a fixed, bounded container
    // (see the grid layout below) — there's nothing to scroll to, and
    // calling scrollTo() here would be pointless at best and could cause
    // visible jank at worst if it fires mid-transition. This is exactly
    // the "if an old scoring-anchor effect still runs on holeIdx, disable
    // it in collapsed mode" instruction.
    if (!scorecardExpanded) return
    const container = scrollContainerRef.current
    const anchor = scoringAnchorRef.current
    if (!container || !anchor) return
    // Measured offset, not scrollIntoView — scrollIntoView's automatic
    // "align to nearest edge" behavior was reported to land inconsistently
    // low, clipping the top of the score card on some devices. This
    // computes the anchor's position relative to the scroll container
    // directly and sets scrollTop precisely, with a small top buffer (8px)
    // so the card isn't flush against the very edge of the screen.
    const anchorTop = anchor.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
    container.scrollTo({ top: Math.max(0, anchorTop - 8), behavior: 'smooth' })
  }, [holeIdx]) // eslint-disable-line react-hooks/exhaustive-deps -- scorecardExpanded intentionally not a dep: checked as a runtime guard only, not a re-trigger reason (the toggle button's own onClick already handles the expand-nudge separately)
  const [resumed, setResumed] = useState(false)
  const [showReconciliation, setShowReconciliation] = useState(false)
  const [submittingFinal, setSubmittingFinal] = useState(false)
  const [submitFinalError, setSubmitFinalError] = useState('')

  async function submitFinalScores() {
    setSubmittingFinal(true)
    setSubmitFinalError('')
    try {
      const res = await fetch(`/api/trips/${tripId}/rounds/${round.id}/scorecards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit' }),
      })
      const resData = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(resData.error ?? "Couldn't finalise your scores. Please try again.")
      // Immediate refresh, matching the same pattern already used after a
      // normal score confirmation — don't wait for the next poll to
      // reflect the locked state.
      void queryClient.invalidateQueries({ queryKey: ['tournament', tripId, round.id] })
      void queryClient.invalidateQueries({ queryKey: ['leaderboard', tripId, round.id] })
    } catch (err) {
      setSubmitFinalError(err instanceof Error ? err.message : "Couldn't finalise your scores. Please try again.")
    } finally {
      setSubmittingFinal(false)
    }
  }

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

  // ── Scoring Anchor (Sprint 5G) ────────────────────────────────────────────
  // The score-entry section is the permanent resting point for every hole
  // transition. Future content (Pro Tips, AI Caddie, course info, etc.) can
  // be inserted above or below this anchor later without changing this
  // behavior — the anchor always resolves to "wherever the score-entry
  // section currently is," not a fixed pixel position or "top of page."
  const scoringAnchorRef = useRef<HTMLDivElement>(null)
  // Collapsed by default on entering active scoring, per the explicit
  // "score first, review the round when needed" requirement. Plain
  // component state — persists across hole-to-hole navigation within
  // the same session (nothing resets it on holeIdx change), and doesn't
  // need to survive logout/across devices, matching the stated scope.
  const [scorecardExpanded, setScorecardExpanded] = useState(false)

  // Body/html scroll lock while collapsed — the actual fix for "the page
  // has two resting positions." Setting overflow:hidden on this
  // component's own container only stops scrolling *within* that
  // container; it does nothing to prevent the outer page/body itself
  // from being taller than the viewport and thus browser-scrollable if
  // the real rendered height is even slightly off from the calc()
  // height used below (100dvh handling varies across Chrome versions,
  // and there's no way to guarantee pixel-perfect accuracy otherwise).
  // Locking the page itself, the same pattern modals use, removes that
  // failure mode entirely rather than depending on a precise measurement.
  useEffect(() => {
    // Round Summary is always a normal scrollable page — never lock the
    // body while viewing it, regardless of the compact strip's collapsed/
    // expanded state (that state belongs to the main scoring view, not
    // this screen).
    if (showReconciliation) return
    if (scorecardExpanded) return
    // Respect the same fallback threshold as the CSS media query above —
    // locking the body unconditionally would defeat the fallback's whole
    // purpose on genuinely short viewports, trapping content that the
    // fallback specifically exists to make reachable via scroll instead.
    if (typeof window !== 'undefined' && window.matchMedia('(max-height: 620px)').matches) return
    const prevBodyOverflow = document.body.style.overflow
    const prevHtmlOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevBodyOverflow
      document.documentElement.style.overflow = prevHtmlOverflow
    }
  }, [scorecardExpanded, showReconciliation])
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const hasHydratedRef = useRef(false)
  const queryClient = useQueryClient()
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
  // Scores are locked once the player's own scorecard has been submitted
  // — reuses the existing scorecards.status/submitted_at columns
  // (migration 004), not a new flag.
  const isLocked = currentMy?.status === 'completed'
  const isPartnerLocked = currentMarked?.status === 'completed'

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
      if (isLocked) return
      setDraftMyGross(g => Math.max(0, Math.min(15, (g ?? 0) + delta)) || null)
      setDraftMyPickedUp(false)
    } else {
      if (isPartnerLocked) return
      setDraftPartnerGross(g => Math.max(0, Math.min(15, (g ?? 0) + delta)) || null)
      setDraftPartnerPickedUp(false)
    }
  }
  function pickPar(which: 'mine' | 'partner') {
    if (which === 'mine') { if (isLocked) return; setDraftMyGross(par); setDraftMyPickedUp(false) }
    else { if (isPartnerLocked) return; setDraftPartnerGross(par); setDraftPartnerPickedUp(false) }
  }
  function togglePickUp(which: 'mine' | 'partner') {
    if (which === 'mine') { if (isLocked) return; setDraftMyPickedUp(p => !p); setDraftMyGross(null) }
    else { if (isPartnerLocked) return; setDraftPartnerGross(null); setDraftPartnerPickedUp(p => !p) }
  }

  const canConfirm = !isLocked && (draftMyGross !== null || draftMyPickedUp)
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
      // Immediate refresh, not waiting for the next poll — matters most
      // when the person confirming is also the organiser (a common setup
      // in this app), so their own My HQ/leaderboard reflect the change
      // right away rather than up to 8s later.
      void queryClient.invalidateQueries({ queryKey: ['tournament', tripId, round.id] })
      void queryClient.invalidateQueries({ queryKey: ['leaderboard', tripId, round.id] })
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
      // Reconciliation trace (client-side console) — matches the server-
      // side trace in the tournament route field-for-field, so if My HQ
      // and this Round Summary screen ever disagree again, both sides'
      // logs can be compared directly rather than inferring from
      // screenshots taken at different times.
      if (requiresMarker) {
        const mySelfVal = mySelf[h.hole_number] ?? null
        const myMarkerVal = myMarker[h.hole_number] ?? null
        console.log('[round-summary reconciliation trace]', {
          hole: h.hole_number,
          playerGross: mySelfVal ? (mySelfVal.pickedUp ? 'no_return' : mySelfVal.grossScore) : null,
          markerGross: myMarkerVal ? (myMarkerVal.pickedUp ? 'no_return' : myMarkerVal.grossScore) : null,
          comparisonResult: mineStatus,
          reviewFlag: mineStatus === 'mismatch',
        })
      }
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

    // Refine the 3-state summary into the 4 states the spec actually wants:
    // 'not_started' (⚪ nothing entered at all) is meaningfully different
    // from 'pending_marker'/'pending_self' (🟡 half-entered, awaiting the
    // other side) — the previous version collapsed both into one "waiting"
    // bucket. Same underlying compareCaptures() statuses, just displayed
    // more precisely.
    const NOT_STARTED: ComparisonStatus[] = ['not_started']
    const detailedSummaryRows = holes.map(h => {
      const r = rows.find(row => row.hole.id === h.id)!
      const isMismatch = r.mineStatus === 'mismatch' || r.partnerStatus === 'mismatch'
      const isNotStarted = !isMismatch && (
        NOT_STARTED.includes(r.mineStatus) && (r.partnerStatus === null || NOT_STARTED.includes(r.partnerStatus))
      )
      const status: 'matched' | 'mismatch' | 'awaiting' | 'not_started' =
        isMismatch ? 'mismatch' : isNotStarted ? 'not_started'
        : (PENDING.includes(r.mineStatus) || (r.partnerStatus !== null && PENDING.includes(r.partnerStatus))) ? 'awaiting'
        : 'matched'
      const myCapture = mySelf[h.hole_number] ?? null
      const gross = myCapture?.pickedUp ? 'P' : myCapture?.grossScore ?? null
      const pts = (myCapture && !myCapture.pickedUp && myCapture.grossScore !== null)
        ? calculateStableford({ grossScore: myCapture.grossScore, par: h.par, strokeIndex: h.stroke_index, playingHandicap: myHcp })
        : (myCapture?.pickedUp ? 0 : null)
      return { hole: h, status, gross, pts }
    })
    const outHoles = detailedSummaryRows.filter(r => r.hole.hole_number <= 9)
    const inHoles = detailedSummaryRows.filter(r => r.hole.hole_number > 9)
    const sumPts = (rs: typeof detailedSummaryRows) => rs.reduce((s, r) => s + (r.pts ?? 0), 0)
    const outTotal = sumPts(outHoles)
    const inTotal = sumPts(inHoles)
    const allMatched = detailedSummaryRows.every(r => r.status === 'matched')
    const STATUS_ICON: Record<string, { icon: string; color: string }> = {
      matched:      { icon: '🟢', color: '#16a34a' },
      mismatch:     { icon: '🔴', color: '#dc2626' },
      awaiting:     { icon: '🟡', color: '#a1791f' },
      not_started:  { icon: '⚪', color: '#d1d5db' },
    }

    return (
      <div style={{ minHeight: '100vh', background: '#faf9f6', padding: '12px 16px 90px' }}>
        <div style={{ textAlign: 'center', marginBottom: 2 }}>
          <div style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 17, fontWeight: 800 }}>Round Summary</div>
          <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, color: '#14532d', marginTop: 2 }}>{myName}</div>
          <div style={{ fontFamily: 'var(--font-body)', color: '#6b7280', fontSize: 11, marginTop: 1 }}>
            {rows.length - mismatches.length - pending.length} holes matched · {mismatches.length} need review{pending.length > 0 ? ` · ${pending.length} waiting` : ''}
          </div>
        </div>

        {allMatched && (
          <div style={{ textAlign: 'center', color: '#16a34a', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, margin: '6px 0 10px' }}>
            ✓ Every hole matched — nothing to review
          </div>
        )}

        {/* Confirm Final Scores — locks the player's own scorecard via
            the existing status/submitted_at columns (migration 004),
            reusing them rather than adding a new flag. Deliberately does
            NOT build organiser finalisation or a winners announcement
            here — those are explicitly left for later, this only adds
            the player-side lock they'd build on top of. */}
        {allMatched && !isLocked && (
          <div style={{ background: '#ffffff', border: '1.5px solid #14532d', borderRadius: 12, padding: 14, marginBottom: 16, textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#374151', marginBottom: 10, lineHeight: 1.5 }}>
              Once you confirm, your scores for this round are final and can&apos;t be edited.
            </div>
            {submitFinalError && <p style={{ color: '#dc2626', fontSize: 11.5, marginBottom: 8, fontFamily: 'var(--font-body)' }}>{submitFinalError}</p>}
            <button
              onClick={submitFinalScores}
              disabled={submittingFinal}
              style={{
                width: '100%', padding: 12, borderRadius: 10, border: 'none',
                background: submittingFinal ? '#9ca3af' : 'linear-gradient(135deg,#2d7a52,#16a34a)',
                color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14,
                cursor: submittingFinal ? 'default' : 'pointer',
              }}
            >
              {submittingFinal ? 'Finalising…' : '✓ Confirm Final Scores'}
            </button>
          </div>
        )}

        {isLocked && (
          <div style={{ background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: 12, padding: 12, marginBottom: 16, textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#16a34a' }}>
              ✓ Scores Finalised
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>
              Your scorecard is locked. The organiser will publish final results once every player has finished.
            </div>
          </div>
        )}

        {/* Full scorecard table — Hole / Par / Gross / Stableford / Status,
            with OUT/IN/TOTAL subtotals. Tap any row to jump to that hole. */}
        <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden', marginTop: allMatched ? 0 : 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', padding: '7px 14px', background: '#f7f6f1', borderBottom: '1px solid #eceae3' }}>
            <span style={{ width: 56, fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, color: '#9ca3af' }}>HOLE</span>
            <span style={{ width: 40, fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, color: '#9ca3af', textAlign: 'center' }}>PAR</span>
            <span style={{ width: 48, fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, color: '#9ca3af', textAlign: 'center' }}>GROSS</span>
            <span style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, color: '#9ca3af', textAlign: 'center' }}>PTS</span>
            <span style={{ width: 24, fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, color: '#9ca3af', textAlign: 'right' }}> </span>
          </div>
          {outHoles.map(r => (
            <SummaryRow key={r.hole.id} r={r} statusIcon={STATUS_ICON[r.status]} onClick={() => { setHoleIdx(holes.indexOf(r.hole)); setShowReconciliation(false) }} />
          ))}
          <SubtotalRow label="OUT" value={outTotal} />
          {inHoles.map(r => (
            <SummaryRow key={r.hole.id} r={r} statusIcon={STATUS_ICON[r.status]} onClick={() => { setHoleIdx(holes.indexOf(r.hole)); setShowReconciliation(false) }} />
          ))}
          {inHoles.length > 0 && <SubtotalRow label="IN" value={inTotal} />}
          <div style={{ display: 'flex', alignItems: 'center', padding: '11px 14px', background: '#fdf3d9', borderTop: '2px solid #e8c96a' }}>
            <span style={{ fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 13.5, color: '#a1791f' }}>TOTAL</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17, color: '#a1791f' }}>{myRunningTotal} pts</span>
          </div>
        </div>

        {/* Detailed breakdown, preserved from the previous reconciliation
            screen — the compact list above tells you WHICH holes need
            review; this still tells you WHY, for anyone who wants it
            before tapping through. */}
        {mismatches.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, color: '#dc2626', marginBottom: 8, textTransform: 'uppercase' }}>
              Needs review
            </div>
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
          <div style={{ marginBottom: 16, fontFamily: 'var(--font-body)', fontSize: 12, color: '#a16207', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: '10px 14px' }}>
            Waiting on marker entries for hole{pending.length > 1 ? 's' : ''}: {pending.map(r => r.hole.hole_number).join(', ')}.
            The round can&apos;t be finally submitted until every hole is matched.
          </div>
        )}

        {mismatches.length === 0 && pending.length === 0 && (() => {
          // Future-ready result states (QA brief item 4) — only "waiting"
          // is real today, since there's no results-publishing engine yet.
          // Structured so a later pass can add 'finalising'/'published'
          // without reworking this component, per the explicit
          // "do not build a new results-publishing engine in this pass."
          const resultState: 'waiting' | 'finalising' | 'published' = 'waiting'
          return (
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
              <div style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 18, fontWeight: 800, marginBottom: 10 }}>
                Score Submitted
              </div>
              <div style={{ fontFamily: 'var(--font-body)', color: '#374151', fontSize: 13.5, lineHeight: 1.6, marginBottom: 16 }}>
                Your score has been successfully submitted.
                {resultState === 'waiting' && <> We&apos;re now waiting for the remaining players to finish. The organiser will review any scoring discrepancies and publish the final leaderboard shortly. You&apos;ll automatically see the final results once they are declared.</>}
              </div>
              <Link href={`/trips/${tripId}/leaderboard`} style={{
                display: 'block', padding: 13, borderRadius: 10, marginBottom: 8,
                background: '#14532d', color: '#fff', textDecoration: 'none',
                fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14,
              }}>
                View Live Leaderboard
              </Link>
              <Link href={`/trips/${tripId}`} style={{
                display: 'block', textAlign: 'center', fontFamily: 'var(--font-body)',
                fontSize: 12.5, color: '#9ca3af', textDecoration: 'none',
              }}>
                Return to Event
              </Link>
            </div>
          )
        })()}

        {(mismatches.length > 0 || pending.length > 0) && (
          <>
            <button
              onClick={() => setShowReconciliation(false)}
              style={{ width: '100%', padding: 12, background: '#ffffff', border: '1.5px solid #d1d5db', borderRadius: 10, color: '#14532d', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, marginBottom: 10 }}
            >
              ← Back to scoring
            </button>
            <Link href={`/trips/${tripId}`} style={{ display: 'block', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af', textDecoration: 'none' }}>
              Return to trip overview
            </Link>
          </>
        )}
      </div>
    )
  }

  // ── Main hole-scoring view ──────────────────────────────────────────────────
  return (
    <div
      className="scoring-workspace-outer"
      style={{
        display: 'flex', flexDirection: 'column', background: '#ffffff',
        // Measured, not estimated: AppNav is Tailwind's h-16 (exactly
        // 64px). TripBottomNav is minHeight:52 (content-box, so additive)
        // + 8px/6px vertical padding + 2px top border ≈ 68px, before
        // env(safe-area-inset-bottom) which is handled separately below.
        ['--app-header-height' as string]: '64px',
        ['--bottom-nav-height' as string]: '68px',
        // 100svh (SMALL viewport height) as the authoritative baseline —
        // not 100dvh alone. svh is, by spec, always the *smallest*
        // possible viewport size regardless of whether Chrome's address
        // bar is currently showing or hidden. Sizing against dvh (which
        // can be LARGER when the bar is hidden) was the actual bug the
        // screenshots exposed: the workspace fit fine with the bar
        // hidden, then had no room to spare the moment it reappeared.
        // svh guarantees the layout is correct for the worst case and
        // simply has a little unused breathing room when more height
        // happens to be available — never the other way around.
        height: scorecardExpanded
          ? 'auto'
          : 'calc(100svh - var(--app-header-height) - var(--bottom-nav-height) - env(safe-area-inset-bottom, 0px))',
        overflow: scorecardExpanded ? 'visible' : 'hidden',
      } as React.CSSProperties}
    >
      {toast && (
        <div style={{ position: 'fixed', top: 72, left: '50%', transform: 'translateX(-50%)', zIndex: 200, background: 'rgba(10,30,18,0.97)', border: '1px solid rgba(201,168,76,0.66)', borderRadius: 22, padding: '8px 18px' }}>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#e8c96a', fontWeight: 700 }}>● {toast}</span>
        </div>
      )}

      {/* Deliberate compact fallback (not a silent default): standard
          portrait phones never reach this — it exists only for
          genuinely short viewports, landscape, or enlarged accessibility
          text, where the fixed workspace truly cannot fit even the
          reduced content. Reduce gaps first, padding second, decorative
          text third, and only enable scrolling as the last resort — the
          breakpoints below progressively compact before the final one
          (620px) allows scrolling at all. */}
      <style>{`
        @media (max-height: 800px) {
          .scoring-card-header { padding: 4px 10px !important; }
          .scoring-card-body { padding: 6px 10px !important; }
        }
        @media (max-height: 700px) {
          .scoring-card-header { padding: 3px 8px !important; }
          .scoring-card-body { padding: 5px 8px !important; }
          .scoring-nav-row { margin-top: 6px !important; }
        }
        @media (max-height: 620px) {
          .scoring-workspace-outer { overflow: visible !important; height: auto !important; }
          .scoring-workspace-fixed { overflow-y: auto !important; height: auto !important; max-height: none !important; }
        }
      `}</style>

      {/* Collapsed: a genuine 3-row CSS grid, not a flex column that
          merely happens to be bounded. Top row (auto): toggle + marked-
          by. Middle row (minmax(0,1fr)): the two cards — minmax(0, ...)
          is what lets this row shrink to fit the remaining space rather
          than pushing the bottom row off-screen, the specific flexbox/
          grid mechanism that makes "no vertical movement" actually hold.
          Bottom row (auto): Confirm Score + Previous/Next, always
          present and never displaced. Expanded: reverts to a normal
          flex column that scrolls, since the golfer explicitly asked to
          review the round. */}
      <div
        ref={scrollContainerRef}
        className={scorecardExpanded ? undefined : 'scoring-workspace-fixed'}
        onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
        style={scorecardExpanded ? {
          flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0,
          overflowY: 'auto', padding: '14px 16px 90px', background: '#faf9f6',
        } : {
          flex: 1, display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr) auto',
          minHeight: 0, overflow: 'hidden',
          padding: '6px 16px calc(6px + env(safe-area-inset-bottom, 0px))',
          background: '#faf9f6', rowGap: 4,
        }}
      >
        {/* ── Compact score strip — collapsible (QA fix): collapsed by
            default on entering active scoring so it never competes with
            the scoring workspace for space; expands on request via the
            toggle button below. Collapsing/expanding never touches
            holeIdx or any capture-map state, so entered scores and the
            selected hole are untouched either way — this is purely a
            visibility toggle, not a remount. Moved inside the scrollable
            region, above the Scoring Anchor (an earlier QA fix):
            previously this sat in fixed, always-visible chrome above the
            scrollable area, eating vertical space and pushing the actual
            scoring controls down/off-screen on short Android viewports.
            Front 9 / Back 9 tiles, current hole highlighted, tap to jump
            where existing scoring permissions already allow (setHoleIdx
            is the same function the header/swipe navigation already
            uses — no new navigation rule introduced). Shows MY confirmed
            self-entries only, reusing calculateStableford() — the same
            function myRunningTotal already calls, not a second
            calculation. ────────────────────────────────────────────── */}
        <div style={scorecardExpanded ? { padding: '0 0 10px', borderBottom: '1px solid #eceae3', marginBottom: 12 } : { gridRow: '1' }}>
          <button
            onClick={() => {
              const willExpand = !scorecardExpanded
              setScorecardExpanded(willExpand)
              if (willExpand) {
                // "Automatically reveal the active hole when expanded" —
                // the strip renders above the anchor, so expanding it
                // adds height above the current view; nudge the scroll up
                // slightly so the newly-revealed active-hole tile is
                // actually visible rather than just pushing content down
                // off-screen above the viewport.
                requestAnimationFrame(() => {
                  scrollContainerRef.current?.scrollBy({ top: -140, behavior: 'smooth' })
                })
              } else {
                // Collapsing: return immediately to the exact standard
                // resting position, scroll position zero — not smooth,
                // since this should feel instantaneous, matching "restore
                // the fixed-height workspace" rather than an animated
                // scroll back to a position that's about to become
                // non-scrollable anyway.
                scrollContainerRef.current?.scrollTo({ top: 0 })
              }
            }}
            style={{
              width: '100%', textAlign: 'center', padding: scorecardExpanded ? '7px 0' : '3px 0', marginBottom: scorecardExpanded ? 10 : 0,
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#a1791f',
            }}
          >
            {scorecardExpanded ? '▲ Hide Round Scorecard' : '▼ View Round Scorecard'}
          </button>

          {!scorecardExpanded && currentMarkedByName && (
            <div style={{ textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 9.5, color: '#b0b6be' }}>
              Marked by {currentMarkedByName}
            </div>
          )}

          {scorecardExpanded && (() => {
            const front9 = holes.filter(h => h.hole_number <= 9)
            const back9 = holes.filter(h => h.hole_number > 9)
            const front9Pts = front9.reduce((s, h) => {
              const c = mySelf[h.hole_number]
              if (!c || c.pickedUp || c.grossScore === null) return s
              return s + calculateStableford({ grossScore: c.grossScore, par: h.par, strokeIndex: h.stroke_index, playingHandicap: myHcp })
            }, 0)
            const front9Done = front9.every(h => {
              const c = mySelf[h.hole_number]
              return !!c && (c.pickedUp || c.grossScore !== null)
            })

            function renderTile(h: Hole, idx: number) {
              const c = mySelf[h.hole_number]
              const isCurrent = idx === holeIdx
              const hasScore = c && (c.pickedUp || c.grossScore !== null)
              const pts = hasScore && !c!.pickedUp && c!.grossScore !== null
                ? calculateStableford({ grossScore: c!.grossScore!, par: h.par, strokeIndex: h.stroke_index, playingHandicap: myHcp })
                : null
              const bg = isCurrent ? '#16a34a' : hasScore ? (pts !== null ? stripPtsBackground(pts) : '#fdf3d9') : '#f3f4f6'
              const fg = isCurrent ? '#fff' : hasScore ? (pts !== null ? stripPtsColor(pts) : '#a1791f') : '#9ca3af'
              return (
                <button
                  key={h.id}
                  onClick={() => setHoleIdx(idx)}
                  style={{
                    flex: '1 1 0', minWidth: 0, height: 36, borderRadius: 6, cursor: 'pointer',
                    background: bg, border: `1.5px solid ${isCurrent ? '#14532d' : '#e5e2d9'}`,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    transform: isCurrent ? 'scale(1.06)' : 'scale(1)', transition: 'transform 0.12s',
                    padding: 0,
                  }}
                >
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: fg }}>{h.hole_number}</span>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 8, fontWeight: 600, color: fg }}>
                    {c?.pickedUp ? 'P' : c?.grossScore ?? '–'}
                  </span>
                </button>
              )
            }

            return (
              <>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700, letterSpacing: 0.6, color: front9Done ? '#16a34a' : '#9ca3af', marginBottom: 4 }}>
                  {front9Done ? `✓ FRONT 9 COMPLETE — ${front9Pts} PTS` : 'FRONT 9'}
                </div>
                <div style={{ display: 'flex', gap: 3, marginBottom: 6 }}>
                  {front9.map((h) => renderTile(h, holes.indexOf(h)))}
                </div>
                {back9.length > 0 && (
                  <>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700, letterSpacing: 0.6, color: '#9ca3af', marginBottom: 4 }}>
                      BACK 9
                    </div>
                    <div style={{ display: 'flex', gap: 3, marginBottom: 4 }}>
                      {back9.map((h) => renderTile(h, holes.indexOf(h)))}
                    </div>
                  </>
                )}
              </>
            )
          })()}

          {scorecardExpanded && currentMarkedByName && (
            <div style={{ textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 10, color: '#b0b6be', marginTop: 6 }}>
              Marked by {currentMarkedByName}
            </div>
          )}
        </div>

        {/* Scoring Anchor — the permanent resting point for every hole
            transition (expanded mode only; collapsed mode disables the
            anchor-scroll effect entirely, per the explicit instruction,
            since this fixed grid has nothing to scroll to). Future
            Premium content sits above this div without needing this
            component's behavior to change. */}
        <div
          ref={scoringAnchorRef}
          style={scorecardExpanded ? undefined : { gridRow: '2', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        >
        {/* ── Card 1: YOUR SCORE ─────────────────────────────────────────── */}
        <ScoreCard
          title="YOUR SCORE" name={myName} hcp={myHcp} par={par} si={si} strokes={myStrokes} holeNum={holeNum}
          gross={draftMyGross} pickedUp={draftMyPickedUp} pts={myPts} runningTotal={myRunningTotal}
          onPick={d => pick('mine', d)} onPar={() => pickPar('mine')} onTogglePickUp={() => togglePickUp('mine')}
          status={myComparison} onOpenSummary={() => setShowReconciliation(true)} hole={hole} isLockedForSide={isLocked}
        />

        {/* ── Card 2: YOUR MARKER (the partner I mark) ──────────────────── */}
        {requiresMarker && markedScorecard && partnerName && (
          <ScoreCard
            title="YOUR MARKER" name={partnerName} hcp={partnerHcp} par={par} si={si} strokes={partnerStrokes} holeNum={holeNum}
            gross={draftPartnerGross} pickedUp={draftPartnerPickedUp} pts={partnerPts} runningTotal={partnerRunningTotal}
            onPick={d => pick('partner', d)} onPar={() => pickPar('partner')} onTogglePickUp={() => togglePickUp('partner')}
            status={partnerComparison} onOpenSummary={() => setShowReconciliation(true)} isLockedForSide={isPartnerLocked}
          />
        )}
        </div>

        <div style={scorecardExpanded ? undefined : { gridRow: '3' }}>
        <button
          onClick={confirmScore}
          disabled={!canConfirm || flash}
          style={{
            width: '100%', padding: 11, marginTop: 4,
            background: flash ? '#16a34a' : canConfirm ? 'linear-gradient(135deg,#2d7a52,#16a34a)' : '#e5e7eb',
            color: canConfirm || flash ? '#fff' : '#9ca3af', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-body)',
            cursor: canConfirm ? 'pointer' : 'not-allowed',
          }}
        >
          {flash ? '✓ Saved!' : isLocked ? 'Scores Finalised' : '✓ Confirm Score'}
        </button>

        <div className="scoring-nav-row" style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <button
            onClick={() => setHoleIdx(i => Math.max(0, i - 1))}
            disabled={holeIdx === 0}
            style={{
              flex: 1, padding: 9, borderRadius: 9,
              background: holeIdx === 0 ? '#f3f4f6' : '#ffffff',
              border: '1.5px solid #d1d5db',
              color: holeIdx === 0 ? '#c3c8ce' : '#14532d',
              fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12,
              cursor: holeIdx === 0 ? 'default' : 'pointer',
            }}
          >
            ← Previous Hole
          </button>
          {holeIdx < holes.length - 1 ? (
            <button
              onClick={() => setHoleIdx(i => Math.min(holes.length - 1, i + 1))}
              style={{ flex: 1, padding: 9, borderRadius: 9, background: '#ffffff', border: '1.5px solid #d1d5db', color: '#14532d', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
            >
              Next Hole →
            </button>
          ) : (
            <button
              onClick={() => setShowReconciliation(true)}
              style={{ flex: 1, padding: 9, borderRadius: 9, background: '#14532d', border: 'none', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
            >
              Round Summary →
            </button>
          )}
        </div>
        </div>

        {scorecardExpanded && isOrganiser && (
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
  title, name, hcp, par, si, strokes, holeNum, gross, pickedUp, pts, runningTotal, onPick, onPar, onTogglePickUp, status, onOpenSummary, hole, isLockedForSide,
}: {
  title: string; name: string; hcp: number; par: number; si: number; strokes: number; holeNum: number
  gross: number | null; pickedUp: boolean; pts: number | null; runningTotal: number
  onPick: (delta: number) => void; onPar: () => void; onTogglePickUp: () => void
  status: ComparisonStatus | null; onOpenSummary?: () => void; hole?: Hole | null; isLockedForSide?: boolean
}) {
  return (
    <div style={{ borderRadius: 12, background: '#ffffff', border: '1px solid #eceae3', boxShadow: '0 3px 14px rgba(0,0,0,0.08)', marginBottom: 4, overflow: 'hidden' }}>
      <div className="scoring-card-header" style={{ background: '#f7f6f1', padding: '3px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #eceae3' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 8.5, fontWeight: 700, color: '#a1791f', letterSpacing: 0.7 }}>{title}</div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 800, color: '#14532d', lineHeight: 1.1 }}>
            {name}
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 9.5, fontWeight: 500, color: '#b0b6be' }}>
            Playing Handicap {hcp}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 800, color: '#14532d', lineHeight: 1 }}>H{holeNum}</div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 8.5, color: '#9ca3af', marginTop: 1 }}>Par {par} · Index {si}</div>
          {strokes > 0 && (
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 8, fontWeight: 600, color: '#a1791f', marginTop: 1 }}>
              Receives {strokes} stroke{strokes === 1 ? '' : 's'}
            </div>
          )}
          {hole && <HoleBadges hole={hole} />}
          {status && (status === 'matched' || status === 'mismatch') && (
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 8.5, fontWeight: 700, color: statusColor(status), marginTop: 1 }}>
              {COMPARISON_LABEL[status]}
            </div>
          )}
        </div>
      </div>

      <div className="scoring-card-body" style={{ padding: '7px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <button onClick={() => onPick(-1)} disabled={isLockedForSide} style={{ width: 40, height: 40, borderRadius: 10, background: isLockedForSide ? '#f3f4f6' : '#f7f6f1', border: '1.5px solid #e5e2d9', color: isLockedForSide ? '#c3c8ce' : '#14532d', fontSize: 18, flexShrink: 0, cursor: isLockedForSide ? 'default' : 'pointer' }}>−</button>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-display)', color: pickedUp ? '#c9a84c' : gross === null ? '#d1d5db' : '#14532d', fontSize: 34, fontWeight: 800, lineHeight: 1 }}>
              {pickedUp ? 'P' : gross ?? '0'}
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, color: '#6b7280', marginTop: 2 }}>
              {pickedUp ? '0 Points (pick-up)' : pts !== null ? `${pts} Point${pts === 1 ? '' : 's'}` : 'Par ' + par + ' · SI ' + si}
            </div>
          </div>
          <button onClick={() => onPick(1)} disabled={isLockedForSide} style={{ width: 40, height: 40, borderRadius: 10, background: isLockedForSide ? '#f3f4f6' : '#f7f6f1', border: '1.5px solid #e5e2d9', color: isLockedForSide ? '#c3c8ce' : '#14532d', fontSize: 18, flexShrink: 0, cursor: isLockedForSide ? 'default' : 'pointer' }}>+</button>
        </div>

        {/* Pick Up — relocated here from the permanent tile row below, per
            Darren's feedback. Same onTogglePickUp behavior, just moved: it's
            an action, not a status, so it reads better as a small secondary
            control near the score selector than as one-third of the
            PAR/SHOTS/TOTAL summary row. */}
        <div style={{ textAlign: 'center', marginTop: 0 }}>
          <button
            onClick={onTogglePickUp}
            disabled={isLockedForSide}
            style={{
              fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
              color: pickedUp ? '#a1791f' : '#6b7280',
              background: pickedUp ? '#fdf3d9' : '#f7f6f1',
              border: pickedUp ? '1px solid #e8c96a' : '1px solid #d5d1c7',
              borderRadius: 18, padding: '2px 10px', cursor: 'pointer',
            }}
          >
            {pickedUp ? '✕ Picked up — tap to undo' : 'Pick up'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 5, marginTop: 4 }}>
          <button onClick={onPar} disabled={isLockedForSide} style={{ flex: 1, padding: '4px 3px', borderRadius: 7, background: gross === par && !pickedUp ? '#dcfce7' : '#eefbf2', border: gross === par && !pickedUp ? '1px solid #86efac' : '1px solid #dcf1e2', textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 7.5, color: gross === par && !pickedUp ? '#16a34a' : '#5a9c72' }}>PAR</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 800, color: '#16a34a' }}>{par}</div>
          </button>
          <div style={{ flex: 1, textAlign: 'center', padding: '4px 3px', borderRadius: 7, background: '#f7f6f1', border: '1px solid #e5e2d9' }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 7.5, color: '#9ca3af' }}>SHOTS</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 12.5, color: '#14532d', fontWeight: 700 }}>{strokes}</div>
          </div>
          <button
            onClick={onOpenSummary}
            disabled={!onOpenSummary}
            style={{ flex: 1, textAlign: 'center', padding: '4px 3px', borderRadius: 7, background: '#fdf3d9', border: '1px solid #e8c96a', cursor: onOpenSummary ? 'pointer' : 'default' }}
          >
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 7.5, color: '#a1791f' }}>TOTAL</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 800, color: '#a1791f' }}>{runningTotal}</div>
          </button>
        </div>
      </div>
    </div>
  )
}
