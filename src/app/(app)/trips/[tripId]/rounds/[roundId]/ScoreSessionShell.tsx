'use client'

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { calculateStableford } from '@/lib/scoring/stableford'
import { getHandicapStrokesForHole } from '@/lib/scoring/strokeAllocation'
import { queueScoreEntry, getPendingCount, getQueuedEntriesForScorecards } from '@/lib/db/dexie'
import { syncScoreQueue, initSyncListeners } from '@/lib/db/sync'
import { useSyncStore, selectSyncLabel } from '@/store/syncStore'
import PendingVerificationCard from '@/components/scoring/PendingVerificationCard'
import SideCompEntryPanel from '@/components/scoring/SideCompEntryPanel'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Hole { id: string; hole_number: number; par: number; stroke_index: number; distance?: number | null }

// Sprint 9 — reused constant, same icons/labels as SelfMarkerScoreShell's
// own SIDE_COMP_BANNER. Not imported from there (that file has no
// exports; both are page-level shells, not a shared module today) —
// duplicated as a small, static lookup table rather than introducing a
// new shared module for three icon/label pairs. If a third scoring shell
// ever needs this, that's the point to extract it.
const SIDE_COMP_BANNER: Record<string, { icon: string; label: string }> = {
  nearest_pin:   { icon: '🎯', label: 'Nearest the Pin' },
  longest_drive: { icon: '💥', label: 'Longest Drive' },
  pros_approach: { icon: '🎯', label: "Pro's Approach" },
}

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
  return '#f3f4f6'
}

function initialsOf(name: string): string {
  return name.slice(0, 2).toUpperCase()
}

// Per-scorecard, per-hole-number score/confirmed maps.
type ScoreMap = Record<string, Record<number, number | null>>
type ConfirmMap = Record<string, Record<number, boolean>>

// Shotgun Start — builds a circular index order into `holes` starting
// from the array index of a given hole number, wrapping around. Used
// only by findResumePosition below; a plain 0..length-1 order is
// returned when startHoleNumber is null (standard rounds, or a
// shotgun group with no assignment), which is exactly the original
// scan order — so passing null preserves existing behaviour exactly.
function circularSearchOrder(holes: Hole[], startHoleNumber: number | null): number[] {
  if (startHoleNumber === null) return holes.map((_, i) => i)
  const startIdx = holes.findIndex(h => h.hole_number === startHoleNumber)
  if (startIdx < 0) return holes.map((_, i) => i)
  return holes.map((_, i) => (startIdx + i) % holes.length)
}

// Find the first hole (by array index) where not every card in the group
// has a confirmed score, and the first not-yet-confirmed card on that hole.
// Used both for the initial "resume where I left off" position and whenever
// an organiser switches to a different playing group.
//
// Shotgun Start — startHoleNumber (this group's assigned starting hole,
// or null) shifts which index the scan effectively starts from via
// circularSearchOrder above, so a freshly-started shotgun round
// correctly resumes at its own starting hole rather than always
// finding Hole 1 "incomplete" and resuming there regardless of where
// the group actually tee'd off. targetHoleIdx still defaults to the
// scan's own last-visited index if every hole is somehow already done
// (unchanged fallback behaviour, just now over the circular order when
// applicable).
function findResumePosition(
  holes: Hole[], group: GroupScorecard[], confirmed: ConfirmMap, startHoleNumber: number | null = null
): { holeIdx: number; activeIdx: number } {
  if (holes.length === 0 || group.length === 0) return { holeIdx: 0, activeIdx: 0 }
  const order = circularSearchOrder(holes, startHoleNumber)
  let targetHoleIdx = order[order.length - 1]
  for (const i of order) {
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
  tripId, round, groupScorecards, allGroups, initialGroupIdx, isOrganiser, currentUserId, dataProblem,
}: Props) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [holes, setHoles]               = useState<Hole[]>([])
  const [loadingHoles, setLoadingHoles] = useState(true)
  // Sprint 9 — same read-only Side Competition/Powerplay awareness added
  // to SelfMarkerScoreShell.tsx, extended here per the explicit "close
  // the group_scorer UX gap before Item 3" instruction: this mode's
  // Powerplay points were already doubling correctly (the Postgres
  // trigger doesn't know or care which scoring shell submitted the
  // score), the scorer just had no visual warning why. Same fields, same
  // /holes response shape, same reasoning — not a duplicated data model.
  const [sideComps, setSideComps] = useState<{ id: string; comp_type: string; hole_number: number | null; enabled: boolean }[]>([])
  const powerplayHoleNumbers = useMemo(
    () => new Set(sideComps.filter(c => c.comp_type === 'powerplay' && c.enabled).map(c => c.hole_number)),
    [sideComps],
  )
  const [scores, setScores]             = useState<ScoreMap>({})
  const [confirmed, setConfirmed]       = useState<ConfirmMap>({})
  const [holeIdx, setHoleIdx]           = useState(0) // 0-indexed into holes array, shared across the group

  // Shotgun Start parity fix — fetched once via the same organiser-
  // facing /starting-holes GET the Begin Round UI already uses (its GET
  // handler is open to any trip member, not organiser-only, so this is
  // a legitimate reuse regardless of who's using this shell). Keyed by
  // group_id so switchGroup (below) can resolve the RIGHT starting hole
  // for whichever group is currently being scored — group_scorer mode
  // can score any group in sequence, each potentially with its own
  // different starting hole, unlike SelfMarkerScoreShell's simpler "my
  // own group only" case.
  const [startType, setStartType] = useState<'standard' | 'shotgun'>('standard')
  const [startingHoleByGroup, setStartingHoleByGroup] = useState<Record<string, number>>({})
  const [startInfoLoaded, setStartInfoLoaded] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetch(`/api/trips/${tripId}/rounds/${round.id}/starting-holes`)
      .then(res => res.ok ? res.json() : null)
      .then(body => {
        if (cancelled || !body) return
        setStartType(body.startType === 'shotgun' ? 'shotgun' : 'standard')
        const map: Record<string, number> = {}
        for (const row of (body.startingHoles ?? []) as { group_id: string; starting_hole: number }[]) map[row.group_id] = row.starting_hole
        setStartingHoleByGroup(map)
      })
      .catch(() => { /* fails safe to standard behaviour, same reasoning as SelfMarkerScoreShell */ })
      .finally(() => { if (!cancelled) setStartInfoLoaded(true) })
    return () => { cancelled = true }
  }, [tripId, round.id])

  // Scoring Anchor (Sprint 5G) — same mechanism as SelfMarkerScoreShell:
  // fires only on holeIdx change (Next/Previous/strip-tap/auto-advance all
  // go through setHoleIdx), never on same-hole edits, skips the first
  // mount so opening the page doesn't itself cause a jump.
  const scoringAnchorRef = useRef<HTMLDivElement>(null)
  const [scorecardExpanded, setScorecardExpanded] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const hasHydratedRef = useRef(false)
  useEffect(() => {
    if (!hasHydratedRef.current) { hasHydratedRef.current = true; return }
    const container = scrollContainerRef.current
    const anchor = scoringAnchorRef.current
    if (!container || !anchor) return
    const anchorTop = anchor.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
    container.scrollTo({ top: Math.max(0, anchorTop - 8), behavior: 'smooth' })
  }, [holeIdx])
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
  const currentGroup: GroupScorecard[] = useMemo(
    () => (allGroups ? (allGroups[activeGroupIdx]?.scorecards ?? []) : groupScorecards),
    [allGroups, activeGroupIdx, groupScorecards]
  )

  // Every scorecard visible to this session, across every group — used only
  // for hydration, so switching groups never shows blank/stale data.
  const allVisibleScorecards: GroupScorecard[] = useMemo(
    () => (allGroups ? allGroups.flatMap(g => g.scorecards) : groupScorecards),
    [allGroups, groupScorecards]
  )

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
          setSideComps(data.sideComps ?? [])
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

      // Resume at the right spot — once only, on initial load. Gated on
      // startInfoLoaded (not just holes/allVisibleScorecards below) so
      // this can't fire before the starting-holes fetch resolves and
      // permanently lock in the wrong (standard) resume order — since
      // resumedRef.current blocks this from ever running a second time,
      // getting the gate wrong here would be a real, silent bug for
      // shotgun rounds specifically.
      if (!resumedRef.current && startInfoLoaded) {
        resumedRef.current = true
        const currentGroupId = allGroups ? (allGroups[activeGroupIdx]?.groupId ?? null) : null
        const singleEntry = Object.entries(startingHoleByGroup)
        const resolvedStartHole = startType === 'shotgun'
          ? (currentGroupId ? startingHoleByGroup[currentGroupId] ?? null : (singleEntry.length === 1 ? singleEntry[0][1] : null))
          : null
        const { holeIdx: rh, activeIdx: ra } = findResumePosition(holes, currentGroup, nextConfirmed, resolvedStartHole)
        setHoleIdx(rh)
        setActiveIdx(ra)
      }
    }
    void hydrate()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holes, allVisibleScorecards, startInfoLoaded])

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
    const groupId = allGroups[idx]?.groupId ?? null
    const resolvedStartHole = startType === 'shotgun' && groupId ? startingHoleByGroup[groupId] ?? null : null
    const { holeIdx: rh, activeIdx: ra } = findResumePosition(holes, grp, confirmed, resolvedStartHole)
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
  // Sprint 9 — this hole's active Side Competitions + whether it's the
  // Powerplay hole. No "one competition per hole" restriction, matching
  // the primary shell exactly.
  // Excludes Powerplay — it gets its own dedicated banner below, so a
  // hole with both Powerplay and, say, NTP configured doesn't show
  // Powerplay twice (once correctly, once via this generic loop with the
  // wrong fallback icon/label — SIDE_COMP_BANNER has no 'powerplay'
  // entry). Every other competition on this hole still renders here,
  // correctly rendering more than one if configured.
  const activeSideComps = sideComps.filter(c => c.enabled && c.hole_number === holeNum && c.comp_type !== 'powerplay')
  const isPowerplayHole = powerplayHoleNumbers.has(holeNum)
  const pts      = gross !== null ? calculateStableford({ grossScore: gross, par, strokeIndex: si, playingHandicap: hcp, isPowerplayHole }) : null
  const basePts  = gross !== null ? calculateStableford({ grossScore: gross, par, strokeIndex: si, playingHandicap: hcp }) : null

  const cardConfirmedPts = useCallback((card: GroupScorecard) => {
    return holes.reduce((sum, h) => {
      if (!confirmed[card.id]?.[h.hole_number]) return sum
      const g = scores[card.id]?.[h.hole_number]
      if (!g) return sum
      return sum + calculateStableford({ grossScore: g, par: h.par, strokeIndex: h.stroke_index, playingHandicap: card.playing_handicap, isPowerplayHole: powerplayHoleNumbers.has(h.hole_number) })
    }, 0)
  }, [holes, confirmed, scores, powerplayHoleNumbers])

  const cardHolesPlayed = useCallback((card: GroupScorecard) => {
    return holes.filter(h => confirmed[card.id]?.[h.hole_number]).length
  }, [holes, confirmed])

  const confirmedPts = activeCard ? cardConfirmedPts(activeCard) : 0
  const front9Pts = activeCard ? holes.filter(h => h.hole_number <= 9).reduce((sum, h) => {
    const g = scores[activeCard.id]?.[h.hole_number]
    if (!g || !confirmed[activeCard.id]?.[h.hole_number]) return sum
    return sum + calculateStableford({ grossScore: g, par: h.par, strokeIndex: h.stroke_index, playingHandicap: hcp, isPowerplayHole: powerplayHoleNumbers.has(h.hole_number) })
  }, 0) : 0
  const back9Pts = activeCard ? holes.filter(h => h.hole_number > 9).reduce((sum, h) => {
    const g = scores[activeCard.id]?.[h.hole_number]
    if (!g || !confirmed[activeCard.id]?.[h.hole_number]) return sum
    return sum + calculateStableford({ grossScore: g, par: h.par, strokeIndex: h.stroke_index, playingHandicap: hcp, isPowerplayHole: powerplayHoleNumbers.has(h.hole_number) })
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

    const calcPts = calculateStableford({ grossScore: gross, par, strokeIndex: si, playingHandicap: hcp, isPowerplayHole })
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
    //
    // Shotgun Start parity fix — "stay put once nextHoleIdx reaches
    // holes.length" only made sense when array position meant "reached
    // Hole 18"; for a circular round there's no such stopping point, so
    // shotgun always wraps and advances. Standard rounds keep the exact
    // original "stay put at the end" behaviour.
    const isLastInGroup = activeIdx >= currentGroup.length - 1
    const isShotgunSession = startType === 'shotgun'
    const nextHoleIdx = isShotgunSession ? (holeIdx + 1) % holes.length : holeIdx + 1

    setTimeout(() => {
      if (!isLastInGroup) {
        setActiveIdx(activeIdx + 1)
      } else if (isShotgunSession || nextHoleIdx < holes.length) {
        setHoleIdx(nextHoleIdx)
        setActiveIdx(0)
      }
      // If it's the last player on the last hole of a standard round:
      // stay put — finishing the round is a Sprint 5C/6 concern, not
      // this screen's job. (Correction to my own comment above: this
      // shell has no order-independent "allDone" completion trigger of
      // its own at all — reaching the array's end was never anything
      // more than a navigation bound here, never a completion signal —
      // so wrapping it for shotgun removes nothing that existed.)
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
    // Shotgun Start parity fix — same circular-wrap treatment already
    // applied to SelfMarkerScoreShell. Standard rounds keep the exact
    // original clamped behaviour.
    if (startType === 'shotgun') {
      if (dx < 0) setHoleIdx(h => (h + 1) % holes.length)
      if (dx > 0) setHoleIdx(h => (h - 1 + holes.length) % holes.length)
    } else {
      if (dx < 0 && holeIdx < holes.length - 1) setHoleIdx(h => h + 1)
      if (dx > 0 && holeIdx > 0) setHoleIdx(h => h - 1)
    }
  }

  // ── Tile metadata for hole strip (reflects the ACTIVE player's card) ──────
  function tileMeta(h: Hole): { bg: string; label: string; sub: string; color?: string } {
    if (!activeCard) return { bg: '#f3f4f6', label: String(h.hole_number), sub: `p${h.par}` }
    const g = scores[activeCard.id]?.[h.hole_number]
    const isConf = confirmed[activeCard.id]?.[h.hole_number]
    if (!isConf || !g) {
      return { bg: '#f3f4f6', label: String(h.hole_number), sub: `p${h.par}` }
    }
    const p = calculateStableford({ grossScore: g, par: h.par, strokeIndex: h.stroke_index, playingHandicap: activeCard.playing_handicap, isPowerplayHole: powerplayHoleNumbers.has(h.hole_number) })
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
      <div style={{ minHeight: '100vh', background: '#faf9f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', maxWidth: 320, padding: '0 20px' }}>
          <p style={{ fontSize: 32, marginBottom: 8 }}>⛳</p>
          <p style={{ fontFamily: 'var(--font-body)', color: '#6b7280', fontSize: 13 }}>
            {message}
          </p>
          <Link href={`/trips/${tripId}`} style={{ display: 'block', marginTop: 16, fontFamily: 'var(--font-body)', fontSize: 12, color: '#14532d', fontWeight: 700, textDecoration: 'none' }}>
            ← Back to trip
          </Link>
        </div>
      </div>
    )
  }

  const front9: Hole[] = holes.filter(h => h.hole_number <= 9)
  const back9: Hole[]  = holes.filter(h => h.hole_number > 9)
  const isBack9 = (holes[holeIdx]?.hole_number ?? holeIdx + 1) > 9
  const activeName = activeCard.profiles?.full_name ?? 'Player'

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#ffffff', minHeight: '100vh', position: 'relative' }}>

      {/* ── Round status bar ───────────────────────────────────────────────── */}
      <div style={{ padding: '16px 16px 12px', borderBottom: '2px solid #c9a84c', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>🚩</span>
          <span style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 17, fontWeight: 800 }}>
            {round.name} — round in progress
          </span>
          {displaySyncLabel && (
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-body)', fontSize: 10, color: syncState === 'synced' ? '#16a34a' : syncState === 'error' ? '#dc2626' : '#9ca3af' }}>
              {displaySyncLabel}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'radial-gradient(#e8c96a,#c9a84c)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-body)', fontWeight: 900, color: '#0f2d1c', fontSize: 10, flexShrink: 0 }}>
            {initialsOf(activeName)}
          </div>
          <span style={{ fontFamily: 'var(--font-body)', color: '#374151', fontWeight: 700, fontSize: 12 }}>Scoring for {activeName}</span>
          {isOrganiser && (
            <span style={{ background: '#fdf3d9', border: '1px solid #e8c96a', borderRadius: 16, padding: '2px 8px', fontFamily: 'var(--font-body)', color: '#a1791f', fontSize: 9.5, fontWeight: 700 }}>ORGANISER</span>
          )}
        </div>
      </div>

      {/* ── Toast ──────────────────────────────────────────────────────────── */}
      {toast && (
        <div style={{
          // Same root cause/fix as AppNav.tsx's header and the shared
          // .toast CSS class (globals.css) — a bare 72px doesn't account
          // for env(safe-area-inset-top). pointerEvents: 'none' below
          // already means this was never tap-blocking; fixed for correct
          // visual positioning on iOS, same bug class, not unrelated.
          position: 'fixed', top: 'calc(72px + env(safe-area-inset-top, 0px))', left: '50%', transform: 'translateX(-50%)',
          zIndex: 200, pointerEvents: 'none',
          background: 'rgba(10,30,18,0.97)', border: '1px solid rgba(201,168,76,0.66)',
          borderRadius: 22, padding: '8px 18px', whiteSpace: 'nowrap',
          boxShadow: '0 4px 24px rgba(0,0,0,0.7)', maxWidth: '90vw',
        }}>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#e8c96a', fontWeight: 700 }}>● {toast}</span>
        </div>
      )}

      {/* ── Scrollable body ────────────────────────────────────────────────── */}
      <div ref={scrollContainerRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>

        {/* ── Organiser: playing-group switcher ────────────────────────────── */}
        {allGroups && allGroups.length > 1 && (
          <div style={{ padding: '10px 16px 0', flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700, letterSpacing: 1, color: '#9ca3af', marginBottom: 6 }}>
              ORGANISER — SWITCH PLAYING GROUP
            </div>
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
              {allGroups.map((g, i) => (
                <button key={g.groupId} onClick={() => switchGroup(i)} style={{
                  flexShrink: 0, padding: '6px 12px', borderRadius: 20, cursor: 'pointer',
                  background: i === activeGroupIdx ? '#fdf3d9' : '#f7f6f1',
                  border: i === activeGroupIdx ? '1.5px solid #e8c96a' : '1px solid #e5e2d9',
                  fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700,
                  color: i === activeGroupIdx ? '#a1791f' : '#6b7280',
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
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700, letterSpacing: 1, color: '#9ca3af', marginBottom: 6 }}>
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
                    background: isOn ? '#dcfce7' : '#f7f6f1',
                    border: isOn ? '1.5px solid #16a34a' : '1px solid #e5e2d9',
                  }}>
                    <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'radial-gradient(#e8c96a,#c9a84c)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-body)', fontWeight: 900, color: '#0f2d1c', fontSize: 9 }}>
                      {initialsOf(name)}
                    </span>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: isOn ? '#14532d' : '#6b7280' }}>
                      {name.split(' ')[0]}
                    </span>
                    {done && <span style={{ fontSize: 10, color: '#16a34a' }}>✓</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Hole strip — collapsible, collapsed by default (QA fix,
            matching SelfMarkerScoreShell's identical treatment). ────────── */}
        <div style={{ padding: '10px 16px 6px', flexShrink: 0 }}>
          <button
            onClick={() => {
              const willExpand = !scorecardExpanded
              setScorecardExpanded(willExpand)
              if (willExpand) {
                requestAnimationFrame(() => {
                  scrollContainerRef.current?.scrollBy({ top: -140, behavior: 'smooth' })
                })
              }
            }}
            style={{
              width: '100%', textAlign: 'center', padding: '5px 0', marginBottom: scorecardExpanded ? 8 : 0,
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#a1791f',
            }}
          >
            {scorecardExpanded ? '▲ Hide Round Scorecard' : '▼ View Round Scorecard'}
          </button>

          {scorecardExpanded && (
            <>
              {front9.length > 0 && (
                <>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700, letterSpacing: 1, color: '#16a34a', marginBottom: 4 }}>
                    {front9Pts > 0 ? `✓ FRONT 9 — ${front9Pts} PTS` : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
                    {front9.map((h) => {
                      const i = holes.indexOf(h)
                      const m = tileMeta(h)
                      const isOn = i === holeIdx
                      return (
                        <div key={h.id} onClick={() => setHoleIdx(i)} style={{
                          flex: '1 1 0', minWidth: 0, height: 36, borderRadius: 6, cursor: 'pointer',
                          background: isOn ? '#16a34a' : m.bg,
                          border: `1.5px solid ${isOn ? '#14532d' : '#e5e2d9'}`,
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                          transform: isOn ? 'scale(1.06)' : 'scale(1)', transition: 'transform 0.12s',
                          boxShadow: isOn ? '0 4px 14px rgba(22,163,74,0.35)' : undefined,
                          position: 'relative',
                        }}>
                          {(sideComps.some(c => c.enabled && c.hole_number === h.hole_number) || powerplayHoleNumbers.has(h.hole_number)) && (
                            <span style={{ position: 'absolute', top: -5, right: -4, fontSize: 10, lineHeight: 1 }}>
                              {powerplayHoleNumbers.has(h.hole_number) ? '⚡' : '⭐'}
                            </span>
                          )}
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: isOn ? '#fff' : (m.color ?? '#6b7280') }}>{m.label}</div>
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: 7.5, fontWeight: 600, color: isOn ? '#e8c96a' : (m.color ?? '#9ca3af') }}>{m.sub}</div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              {back9.length > 0 && (
                <>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700, letterSpacing: 1, color: '#9ca3af', marginBottom: 4 }}>
                    BACK 9 — {isBack9 ? 'ENTERING NOW' : 'COMING UP'}
                  </div>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {back9.map((h) => {
                      const realIdx = holes.indexOf(h)
                      const m = tileMeta(h)
                      const isOn = realIdx === holeIdx
                      return (
                        <div key={h.id} onClick={() => setHoleIdx(realIdx)} style={{
                          flex: '1 1 0', minWidth: 0, height: 42, borderRadius: 7, cursor: 'pointer',
                          background: isOn ? '#16a34a' : m.bg,
                          border: `1.5px solid ${isOn ? '#14532d' : '#e5e2d9'}`,
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                          transform: isOn ? 'scale(1.06)' : 'scale(1)', transition: 'transform 0.12s',
                          boxShadow: isOn ? '0 4px 14px rgba(22,163,74,0.35)' : undefined,
                          position: 'relative',
                        }}>
                          {(sideComps.some(c => c.enabled && c.hole_number === h.hole_number) || powerplayHoleNumbers.has(h.hole_number)) && (
                            <span style={{ position: 'absolute', top: -5, right: -4, fontSize: 10, lineHeight: 1 }}>
                              {powerplayHoleNumbers.has(h.hole_number) ? '⚡' : '⭐'}
                            </span>
                          )}
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: isOn ? '#fff' : (m.color ?? '#6b7280') }}>{m.label}</div>
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: 8, fontWeight: 600, color: isOn ? '#e8c96a' : (m.color ?? '#9ca3af') }}>{m.sub}</div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Side Game Marker Verification Stage 3 — the operator running
            group_scorer mode may be the organiser-fallback verifier for
            a claim (round_markers doesn't apply to this mode, so the
            fallback hierarchy from migration 047 can resolve here) —
            same non-blocking, collapsed-by-default card as
            SelfMarkerScoreShell, not a second implementation. */}
        <PendingVerificationCard tripId={tripId} roundId={round.id} />

        {/* Scoring Anchor — the permanent resting point for every hole
            transition, same role as in SelfMarkerScoreShell. */}
        <div ref={scoringAnchorRef} />

        {/* ── Sprint 9 — competition-hole announcement banners, same
            treatment as SelfMarkerScoreShell (reused pattern, not a
            separate implementation): inline, not blocking, Powerplay
            gets the stronger gold treatment. Read-only awareness only —
            no result entry, no Capture Moment, matching this pass's
            explicit scope. ─────────────────────────────────────────── */}
        {isPowerplayHole && (
          <div style={{
            margin: '0 16px 10px', background: 'linear-gradient(135deg,#7a5c00,#a1791f)', borderRadius: 12,
            padding: '12px 14px', textAlign: 'center', boxShadow: '0 3px 12px rgba(161,121,31,0.35)',
          }}>
            <div style={{ fontFamily: 'var(--font-display)', color: '#fff', fontWeight: 900, fontSize: 14, letterSpacing: 0.3 }}>
              ⚡ POWERPLAY — ACTIVE
            </div>
            <div style={{ fontFamily: 'var(--font-body)', color: '#fdf3d9', fontWeight: 700, fontSize: 11.5, marginTop: 2, letterSpacing: 0.5 }}>
              DOUBLE STABLEFORD POINTS
            </div>
          </div>
        )}
        {activeSideComps.map(comp => (
          <div key={comp.id} style={{
            margin: '0 16px 10px', background: '#fdf3d9', border: '1.5px solid #e8c96a', borderRadius: 12,
            padding: '10px 14px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>{SIDE_COMP_BANNER[comp.comp_type]?.icon ?? '🎯'}</span>
              <div>
                <div style={{ fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 12.5, color: '#7a5c00', letterSpacing: 0.3 }}>
                  {(SIDE_COMP_BANNER[comp.comp_type]?.label ?? 'SIDE COMPETITION').toUpperCase()} — ACTIVE
                </div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#a1791f' }}>
                  Hole {holeNum} · Par {par}
                </div>
              </div>
            </div>
            {/* Side Games proxy entry — group_scorer mode previously had
                NO Side Games entry UI at all here, just this static
                banner (confirmed by inspection — not a proxy-entry gap
                specifically, a complete absence of entry capability in
                this mode). Reuses SideCompEntryPanel entirely, the same
                component self_and_marker mode already uses, now with
                the full 3-4 player group (not just self+marker) as
                groupMembers — this is the actual scenario the brief's
                own worked example describes (a non-digital third
                player in a larger group), unlike the earlier partial
                pass which only wired the 2-person case. */}
            {(comp.comp_type === 'nearest_pin' || comp.comp_type === 'longest_drive' || comp.comp_type === 'pros_approach') && (
              <SideCompEntryPanel
                tripId={tripId} sideCompId={comp.id} compType={comp.comp_type}
                label={SIDE_COMP_BANNER[comp.comp_type]?.label ?? 'Side Competition'}
                icon={SIDE_COMP_BANNER[comp.comp_type]?.icon ?? '🎯'}
                currentUserId={currentUserId}
                groupMembers={currentGroup.map(c => ({ id: c.player_id, name: c.profiles?.full_name ?? 'Player' }))}
                roundId={round.id} holeNumber={holeNum}
                myGroupId={allGroups ? (allGroups[activeGroupIdx]?.groupId ?? null) : null}
              />
            )}
          </div>
        ))}

        {/* ── Swipeable score entry card ─────────────────────────────────── */}
        <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} style={{ userSelect: 'none', WebkitUserSelect: 'none' as React.CSSProperties['WebkitUserSelect'] }}>
          <div style={{ margin: '0 16px 8px', borderRadius: 14, background: '#ffffff', border: '1px solid #eceae3', boxShadow: '0 4px 18px rgba(0,0,0,0.09)', flexShrink: 0, overflow: 'hidden', position: 'relative' }}>

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

            <div style={{ background: '#f7f6f1', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #eceae3' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'radial-gradient(#e8c96a,#c9a84c)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-body)', fontWeight: 900, color: '#0f2d1c', fontSize: 11 }}>
                  {initialsOf(activeName)}
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--font-body)', color: '#14532d', fontWeight: 800, fontSize: 18, lineHeight: 1.25 }}>{activeName}</div>
                  <div style={{ fontFamily: 'var(--font-body)', color: '#b0b6be', fontSize: 11 }}>Playing Handicap {hcp}</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 20, fontWeight: 800, lineHeight: 1 }}>H{holeNum}</div>
                <div style={{ fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 10.5, fontWeight: 600, marginTop: 1 }}>
                  {hole?.distance != null ? `${hole.distance}m · ` : ''}Par {par} · SI {si}
                </div>
                {strokesReceived > 0 && (
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 600, color: '#a1791f', marginTop: 1 }}>
                    Receives {strokesReceived} stroke{strokesReceived === 1 ? '' : 's'}
                  </div>
                )}
              </div>
            </div>

            <div style={{ padding: '16px 16px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <button onClick={() => pick(-1)} style={{ width: 64, height: 64, borderRadius: 14, flexShrink: 0, background: '#f7f6f1', border: '1.5px solid #e5e2d9', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                  <span style={{ color: '#14532d', fontSize: 28, fontWeight: 300 }}>−</span>
                </button>
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontFamily: 'var(--font-display)', color: gross === null ? '#d1d5db' : '#14532d', fontSize: 64, fontWeight: 800, lineHeight: 1 }}>
                    {gross === null ? '0' : gross}
                  </div>
                  {pts !== null ? (
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, marginTop: 2, color: pts >= 3 ? '#16a34a' : pts === 2 ? '#2563eb' : '#6b7280' }}>
                      {pts} {pts === 1 ? 'Point' : 'Points'}
                    </div>
                  ) : (
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af', marginTop: 2 }}>tap + to add shots · or tap PAR</div>
                  )}
                  {/* Sprint 9 — Powerplay visual treatment, same "before →
                      after" breakdown as SelfMarkerScoreShell. pts above
                      already includes the ×2 (via isPowerplayHole passed
                      into calculateStableford) — this line is purely
                      explanatory. */}
                  {isPowerplayHole && basePts !== null && pts !== null && (
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 5,
                      background: '#fdf3d9', border: '1px solid #e8c96a', borderRadius: 8, padding: '2px 8px',
                    }}>
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#a1791f' }}>
                        ⚡ {basePts} × 2 = {pts} pts
                      </span>
                    </div>
                  )}
                </div>
                <button onClick={() => pick(+1)} style={{ width: 64, height: 64, borderRadius: 14, flexShrink: 0, background: '#f7f6f1', border: '1.5px solid #e5e2d9', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                  <span style={{ color: '#14532d', fontSize: 28, fontWeight: 300 }}>+</span>
                </button>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 10, borderTop: '1px solid #eceae3', paddingTop: 10 }}>
                <button onClick={pickPar} style={{ flex: 1, textAlign: 'center', background: gross === par ? '#dcfce7' : '#eefbf2', borderRadius: 8, padding: '7px 4px', border: gross === par ? '1px solid #86efac' : '1px solid #dcf1e2', cursor: 'pointer', transition: 'all 0.15s' }}>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 9.5, fontWeight: 700, color: gross === par ? '#16a34a' : '#5a9c72', letterSpacing: 0.8, marginBottom: 3 }}>PAR</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, color: '#16a34a' }}>{par}</div>
                </button>
                <div style={{ flex: 1, textAlign: 'center', background: '#f7f6f1', borderRadius: 8, padding: '7px 4px', border: '1px solid #e5e2d9' }}>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 9.5, fontWeight: 700, color: '#9ca3af', letterSpacing: 0.8, marginBottom: 3 }}>SHOTS</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, color: '#14532d' }}>{strokesReceived}</div>
                </div>
                <div style={{ flex: 1, textAlign: 'center', background: '#fdf3d9', borderRadius: 8, padding: '7px 4px', border: '1px solid #e8c96a' }}>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 9.5, fontWeight: 700, color: '#a1791f', letterSpacing: 0.8, marginBottom: 3 }}>TOTAL</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, color: '#a1791f' }}>{confirmedPts}</div>
                </div>
              </div>
            </div>

            <div style={{ padding: '0 16px 14px' }}>
              <button
                onClick={confirmScore}
                disabled={gross === null || gross === 0 || flash}
                style={{
                  width: '100%', padding: 14,
                  background: flash ? '#16a34a' : (gross !== null && gross > 0) ? `linear-gradient(135deg,#2d7a52,#16a34a)` : '#e5e7eb',
                  color: (gross !== null && gross > 0) || flash ? '#ffffff' : '#9ca3af', border: 'none', borderRadius: 10,
                  fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-body)',
                  cursor: (gross !== null && gross > 0) ? 'pointer' : 'not-allowed',
                  letterSpacing: 0.5, transition: 'background 0.2s',
                  boxShadow: gross !== null ? '0 4px 16px rgba(22,163,74,0.25)' : 'none',
                }}
              >
                {flash ? '✓ Saved!' : '✓ Confirm Score'}
              </button>
            </div>
          </div>

          <div style={{ padding: '0 16px 8px', display: 'flex', gap: 8 }}>
            <button
              onClick={() => setHoleIdx(i => startType === 'shotgun' ? (i - 1 + holes.length) % holes.length : Math.max(0, i - 1))}
              disabled={startType !== 'shotgun' && holeIdx === 0}
              style={{
                flex: 1, padding: 10, borderRadius: 10,
                background: (startType !== 'shotgun' && holeIdx === 0) ? '#f3f4f6' : '#ffffff',
                border: '1.5px solid #d1d5db',
                color: (startType !== 'shotgun' && holeIdx === 0) ? '#c3c8ce' : '#14532d',
                fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5,
                cursor: (startType !== 'shotgun' && holeIdx === 0) ? 'default' : 'pointer',
              }}
            >
              ← Previous Hole
            </button>
            {/* Shotgun Start parity fix — same reasoning as
                SelfMarkerScoreShell: "last array position" means
                nothing circularly, so Next always advances (wrapping)
                for shotgun. Round Summary gets its own always-available
                link below instead of being tied to array position. */}
            {startType === 'shotgun' || holeIdx < holes.length - 1 ? (
              <button
                onClick={() => setHoleIdx(i => startType === 'shotgun' ? (i + 1) % holes.length : Math.min(holes.length - 1, i + 1))}
                style={{ flex: 1, padding: 10, borderRadius: 10, background: '#ffffff', border: '1.5px solid #d1d5db', color: '#14532d', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}
              >
                Next Hole →
              </button>
            ) : (
              <Link
                href={`/trips/${tripId}/leaderboard`}
                style={{ flex: 1, padding: 10, borderRadius: 10, background: '#14532d', border: 'none', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5, textAlign: 'center', textDecoration: 'none' }}
              >
                Round Summary →
              </Link>
            )}
          </div>
          {startType === 'shotgun' && (
            <div style={{ padding: '0 16px 8px' }}>
              <Link
                href={`/trips/${tripId}/leaderboard`}
                style={{ display: 'block', width: '100%', padding: 8, borderRadius: 10, background: 'none', border: '1px solid #d9c9a3', color: '#a1791f', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 11.5, textAlign: 'center', textDecoration: 'none' }}
              >
                Round Summary →
              </Link>
            </div>
          )}

          <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: '#9ca3af', textAlign: 'center', paddingTop: 2, paddingBottom: 2, letterSpacing: 0.3 }}>
            Swipe also works
          </div>
        </div>

        {/* ── F9 / B9 totals ──────────────────────────────────────────────── */}
        <div style={{ padding: '4px 16px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af' }}>
            F9: <strong style={{ color: '#16a34a' }}>{front9Pts}</strong>{'  +  '}B9: <strong style={{ color: '#374151' }}>{back9Pts}</strong>
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: '#a1791f', fontWeight: 800 }}>{confirmedPts} pts</div>
        </div>

        {/* ── Group progress (neutral — no rankings, that's Sprint 5C) ─────── */}
        {currentGroup.length > 1 && (
          <div style={{ margin: '6px 16px 20px', flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#a1791f', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 }}>
              Group Progress
            </div>
            <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
              {currentGroup.map(c => {
                const name = c.profiles?.full_name ?? 'Player'
                const played = cardHolesPlayed(c)
                const total = cardConfirmedPts(c)
                const isMe = c.player_id === currentUserId
                return (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #eceae3', background: isMe ? '#fdf3d9' : 'transparent' }}>
                    <div style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 13.5, fontWeight: isMe ? 800 : 600, color: isMe ? '#a1791f' : '#14532d' }}>{name}</div>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af', marginRight: 10 }}>{played}/{holes.length} holes</div>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: isMe ? '#a1791f' : '#6b7280' }}>{total}<span style={{ fontSize: 10, opacity: 0.7 }}> pts</span></div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <Link href={`/trips/${tripId}`} style={{ display: 'block', textAlign: 'center', marginBottom: 90, fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af', textDecoration: 'none' }}>
          ← Return to trip overview
        </Link>

      </div>
    </div>
  )
}
