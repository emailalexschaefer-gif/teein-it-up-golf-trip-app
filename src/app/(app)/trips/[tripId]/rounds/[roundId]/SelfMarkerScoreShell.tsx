'use client'

import React, { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { calculateStableford } from '@/lib/scoring/stableford'
import { getHandicapStrokesForHole } from '@/lib/scoring/strokeAllocation'
import { compareCaptures, COMPARISON_LABEL, isZeroPointsMismatch, type ComparisonStatus, type CaptureValue } from '@/lib/scoring/comparison'
import { queueScoreEntry, getPendingCount, getQueuedEntriesForScorecards } from '@/lib/db/dexie'
import { syncScoreQueue, initSyncListeners } from '@/lib/db/sync'
import { useSyncStore, selectSyncLabel } from '@/store/syncStore'
import { useScoringFocusStore } from '@/store/scoringFocusStore'
import LiveLeaderboard from '@/components/scoring/LiveLeaderboard'
import SideCompEntryPanel from '@/components/scoring/SideCompEntryPanel'
import dynamic from 'next/dynamic'
import type { NewLeaderContext } from '@/components/scoring/NewLeaderPrompt'
import PendingVerificationCard from '@/components/scoring/PendingVerificationCard'
import ExpandableRoundScorecard from '@/components/scoring/ExpandableRoundScorecard'

// P0 live-scoring crash investigation — the one recent, genuinely
// unverified change reachable from this file's own import chain.
// This previously statically imported NewLeaderPrompt, which imports
// MomentCapture, which imports ImageCropper, which imports
// react-easy-crop — a dependency added to package.json in an earlier
// pass that could never actually be installed/tested in this sandbox
// (npm install has failed with a registry 403 every time this
// session). react-easy-crop is a browser-only library (canvas,
// touch/pointer events); if it accesses window/document outside a
// component lifecycle hook, that's a well-known class of Next.js SSR
// crash — and this file, though a Client Component, still gets
// server-rendered for its initial HTML on first load, exactly the
// moment a player first enters scoring. Loading it dynamically with
// ssr: false removes this entire chain from server rendering
// regardless of whether it's the confirmed root cause, which is the
// correct pattern for a browser-only library either way — a genuine
// fix for a real, identified risk, not a randomly-applied speculative
// patch. NewLeaderContext (a type only) is still imported normally
// above, since type imports are erased at compile time and carry none
// of this runtime risk.
const NewLeaderPrompt = dynamic(() => import('@/components/scoring/NewLeaderPrompt'), { ssr: false })

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
  distance?: number | null
  pro_tip?: string | null
  is_powerplay?: boolean
  side_game_type?: 'nearest_pin' | 'longest_drive' | 'straightest_drive' | null
}

// Sprint 9 Item 2 — activated. Previously dormant (no is_powerplay/
// side_game_type column ever existed on holes, confirmed before this
// sprint's investigation), rendering nothing at runtime. Now fed real
// data from the /holes route's sideComps field
// (fetched once per round, see the load effect above) rather than
// fields on the Hole object itself — a hole can carry more than one
// active Side Competition (no "one per hole" rule — deliberately left
// flexible), which a single Hole.side_game_type field couldn't express.
const SIDE_COMP_BANNER: Record<string, { icon: string; label: string }> = {
  nearest_pin:   { icon: '🎯', label: 'Nearest the Pin' },
  longest_drive: { icon: '💥', label: 'Longest Drive' },
  pros_approach: { icon: '🎯', label: "Pro's Approach" },
}

function HoleBadges({ activeSideComps, isPowerplayHole }: {
  activeSideComps: { id: string; comp_type: string }[]; isPowerplayHole: boolean
}) {
  const badges: { icon: string; label: string }[] = []
  if (isPowerplayHole) badges.push({ icon: '⚡', label: 'Powerplay' })
  for (const c of activeSideComps) {
    const meta = SIDE_COMP_BANNER[c.comp_type]
    if (meta) badges.push(meta)
  }
  if (badges.length === 0) return null
  return (
    <div style={{ display: 'flex', gap: 5, marginTop: 3, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
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
  admin_overridden?: boolean
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
  // Offline Player Support, item 9 — the full playing group (digital
  // and paper players alike), for Side Games "Result for" — see this
  // prop's construction in page.tsx for why myMarker/markedScorecard
  // alone aren't enough.
  fullGroupRoster?: { id: string; name: string }[]
  // Add-on 1 (corrected architecture) — when true, the partner card
  // (markedScorecard, already the paper player's REAL scorecard —
  // resolved directly in page.tsx, not via round_markers) renders
  // exactly like a normal digital partner card, except: the heading
  // says "SCORING FOR" + a Paper Player badge instead of "YOUR
  // PLAYING PARTNER", no comparison/reconciliation is ever computed
  // (there is only one entry for this hole — Alex's — so there is
  // nothing to compare), and confirmScore writes the partner's score
  // through the shared-device-score endpoint (capture_role='self' on
  // their own scorecard) instead of the normal capture_role='marker'
  // write. Every other card field — handicap, par, shots, Stableford,
  // Pick Up — is completely unchanged, since none of it was ever
  // specific to how the partner pairing was established.
  isSharedDeviceScoring?: boolean
}

type CaptureMap = Record<number, CaptureValue> // keyed by hole_number

interface OverrideAuditEntry {
  holeId: string; oldGrossScore: number | null; newGrossScore: number
  reason: string; overriddenByName: string; overriddenAt: string
}

interface LiveScores {
  round: { id: string; status: string }
  myScorecard: ScorecardFull | null
  markedScorecard: ScorecardFull | null
  markedByName: string | null
  myOverrideAudit?: OverrideAuditEntry[]
  markedOverrideAudit?: OverrideAuditEntry[]
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
    target[holeNum] = { grossScore: e.gross_score, pickedUp: e.is_no_return, adminOverridden: e.admin_overridden }
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
    // Score-screen override propagation fix — amber/gold, not green,
    // per the explicit colour system: "green = matched, red = needs
    // review, amber/gold = organiser override." Distinct from 'matched'
    // deliberately — an override is resolved, but it isn't the same
    // thing as the player and marker having genuinely agreed.
    case 'resolved_by_organiser': return '#a1791f'
    case 'pending_marker': case 'pending_self': return '#a1791f'
    default: return '#9ca3af'
  }
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function SelfMarkerScoreShell({
  tripId, round, myScorecard, markedScorecard, markedByName, isOrganiser, dataProblem, fullGroupRoster = [], isSharedDeviceScoring = false,
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
  // Shotgun Start. startInfo is fetched once on mount (my-starting-hole,
  // resolves the caller's own group server-side). holeIdxSeeded ensures
  // the seeding effect below runs exactly once — never re-seeds on a
  // later re-render, which would otherwise yank a player back to their
  // starting hole mid-round every time this data happened to refetch.
  // pendingStartHolePick is the local-only (never persisted) fallback
  // for a shotgun round with no group assignment yet — "a fallback, not
  // organiser admin work forced onto players": the player just needs
  // somewhere to start, they can still navigate anywhere afterward.
  const [startInfo, setStartInfo] = useState<{ startType: 'standard' | 'shotgun'; startingHole: number | null } | null>(null)
  const [pendingStartHolePick, setPendingStartHolePick] = useState<number | null>(null)
  const holeIdxSeededRef = useRef(false)
  useEffect(() => {
    let cancelled = false
    fetch(`/api/trips/${tripId}/rounds/${round.id}/my-starting-hole`)
      .then(res => res.ok ? res.json() : null)
      .then(body => { if (!cancelled && body) setStartInfo(body) })
      .catch(() => { if (!cancelled) setStartInfo({ startType: 'standard', startingHole: null }) }) // fails safe to standard behaviour
    return () => { cancelled = true }
  }, [tripId, round.id])
  // Sprint 9 Item 2 — Side Competitions + Powerplay, read-only scoring
  // awareness. Fetched once alongside holes (same round-scoped request,
  // see holes/route.ts) — no write/entry flow reads or writes these yet.
  const [sideComps, setSideComps] = useState<{ id: string; comp_type: string; hole_number: number | null; enabled: boolean }[]>([])
  // Corrected model: Powerplay is just another side_comps row
  // (comp_type = 'powerplay'), not a separate rounds column — a round
  // can have multiple Powerplay holes, so this is a derived Set of every
  // Powerplay hole_number, not a single "the" Powerplay hole.
  const powerplayHoleNumbers = new Set(sideComps.filter(c => c.comp_type === 'powerplay' && c.enabled).map(c => c.hole_number))
  // Side Game Marker Verification Stage 2 — Capture the Moment. This is
  // the ENTIRE one-shot mechanism: null means no prompt is showing, full
  // stop. It is set to a real value in exactly one place in this file
  // (SideCompEntryPanel's onWouldLeadIfVerified callback below, itself
  // only ever fired by a direct POST response), and cleared by the
  // prompt's own onDismiss. No GET, poll, or effect anywhere reads or
  // writes this state — a refresh remounts the whole page with this
  // back at null, and re-renders of unrelated state can't touch it
  // either, since nothing else ever calls setNewLeaderPrompt.
  const [newLeaderPrompt, setNewLeaderPrompt] = useState<NewLeaderContext | null>(null)
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

  const [resumed, setResumed] = useState(false)
  const [showReconciliation, setShowReconciliation] = useState(false)
  // Live Leaderboard overlay — deliberately an in-component overlay, not
  // a route navigation. Navigating to a separate leaderboard page would
  // unmount this component and lose every piece of local unconfirmed-
  // score state (draft gross scores, pick-up toggles) that hasn't been
  // synced yet — exactly what the brief requires preserving. An overlay
  // keeps this component mounted throughout, which is what makes every
  // preservation requirement (hole number, draft scores, sync state)
  // true automatically rather than needing separate state-passing.
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  // Pro Tip — collapsed by default on every hole, per explicit
  // instruction ("changing holes should not leave a giant expanded
  // panel unexpectedly covering the scoring UI"). Reset via the effect
  // below, keyed on holeIdx, rather than just defaulting to false once
  // — without the reset, an expanded tip on Hole 3 would stay expanded
  // after navigating to Hole 4 (React state doesn't auto-reset just
  // because the underlying data changed).
  const [proTipExpanded, setProTipExpanded] = useState(false)
  useEffect(() => { setProTipExpanded(false) }, [holeIdx])

  // Scoring focus mode — signals AppNav/TripBottomNav to hide themselves
  // while actively entering scores, restoring them for Round Summary and
  // on unmount. This is the actual mechanism behind "scoring is its own
  // screen mode": those components render outside this one's own
  // subtree, so a shared store is what lets this reach them.
  const setScoringFocusActive = useScoringFocusStore(s => s.setActive)
  useEffect(() => {
    setScoringFocusActive(!showReconciliation)
    // Unconditional on unmount, regardless of which state was active —
    // this is what guarantees the chrome always comes back when leaving
    // the scoring page by any route (Exit, browser back, tab switch).
    return () => setScoringFocusActive(false)
  }, [showReconciliation, setScoringFocusActive])
  const [submittingFinal, setSubmittingFinal] = useState(false)
  const [submitFinalError, setSubmitFinalError] = useState('')
  const [showConfirmModal, setShowConfirmModal] = useState(false)

  async function submitFinalScores() {
    // Defensive re-check — the modal could theoretically stay open across
    // a brief window where pendingCount changes; this gives a specific,
    // honest message rather than surfacing the server's generic rejection
    // for what is, on the client, a known and explainable condition.
    if (useSyncStore.getState().pendingCount > 0) {
      setSubmitFinalError('Still saving your scores — please wait a moment and try again.')
      return
    }
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
      // Root cause of the confirm→confirm loop: this invalidation list was
      // missing the ONE query that actually drives isLocked/currentMy.status
      // ('round-my-scores', below) — the mutation succeeded and the server
      // correctly persisted status='completed' (see the scorecards route),
      // but the client kept reading a stale cached liveData.myScorecard
      // that still said 'active', so isLocked stayed false and the UI fell
      // straight back into "Your scorecard is ready / Confirm Final Scores"
      // as if nothing had happened. tournament/leaderboard were already
      // being invalidated correctly; this was the missing one.
      void queryClient.invalidateQueries({ queryKey: ['round-my-scores', tripId, round.id] })
      void queryClient.invalidateQueries({ queryKey: ['tournament', tripId, round.id] })
      void queryClient.invalidateQueries({ queryKey: ['leaderboard', tripId, round.id] })
      setShowConfirmModal(false)
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
  // Follow-up UX pass, item 1 — Marnie gets her OWN, independent
  // expand/collapse state, not a second read of scorecardExpanded.
  // Only ever used in shared-device mode (isSharedDeviceScoring) — a
  // normal digital partner never renders this second instance at all.
  const [partnerScorecardExpanded, setPartnerScorecardExpanded] = useState(false)

  // Simple, non-blocking scroll-to-anchor on hole change — gives a
  // sensible resting position when navigating between holes, but never
  // locks or prevents scrolling. The previous version of this effect
  // also locked document scroll (overflow:hidden + touch-action:none)
  // while collapsed; that's been removed entirely per the explicit
  // instruction that every control must remain reachable on every phone
  // size, confirmed by a real smaller/older phone where the lock
  // combined with a bounded container clipped content with no way to
  // reach it. The page must always be able to scroll normally now,
  // regardless of mode.
  // Reset scroll to the true top on every hole change — not the card
  // anchor's offset position, which left "View Round Scorecard" and
  // "Marked by" above the visible area (the exact reported issue: Hole
  // 2 retained Hole 1's scroll offset, clipping both). No longer skips
  // the first run either, so Hole 1 itself is guaranteed to land at the
  // correct top position too, not just subsequent holes. The dependency
  // array is deliberately just [holeIdx] — expanding/collapsing the
  // scorecard or opening another control must never trigger this reset,
  // and keeping scorecardExpanded/showReconciliation out of the
  // dependency array is what guarantees that; they're still read inside
  // the effect (to skip the reset while the strip is expanded, so
  // tapping a hole tile there doesn't collapse the view — preserving
  // expanded browsing as already established) without causing the
  // effect to re-run when only they change.
  useEffect(() => {
    if (!scorecardExpanded && !showReconciliation) {
      window.scrollTo({ top: 0, behavior: 'auto' })
    }
  }, [holeIdx]) // eslint-disable-line react-hooks/exhaustive-deps -- scorecardExpanded/showReconciliation intentionally omitted: read inside to skip the reset while expanded/on Round Summary, but must not themselves trigger a re-run

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  // P0 fix — scroll/sticky-footer trace. Rather than guess a static
  // bottom-padding value (which the brief explicitly asked not to do),
  // this measures the fixed action tray's REAL rendered height and
  // reserves exactly that much trailing space, via ResizeObserver so it
  // self-corrects for every state that changes the tray's height (the
  // sync-status label appearing/disappearing, the shotgun-mode extra
  // Round Summary button, safe-area differences) without needing to
  // know about any of those states here. This is what guarantees Live
  // Leaderboard and everything below it can always be scrolled fully
  // clear of the tray, regardless of whether either horizontal
  // scorecard is expanded — expanding a scorecard only changes how
  // TALL the page's natural content is, which the browser already
  // scrolls to correctly on its own; the actual bug was the reserved
  // trailing space potentially being smaller than the tray itself in
  // some of its states, not anything to do with scorecard expansion
  // specifically.
  const actionTrayRef = useRef<HTMLDivElement>(null)
  const [actionTrayHeight, setActionTrayHeight] = useState(160)
  useEffect(() => {
    const el = actionTrayRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const height = entries[0]?.contentRect.height
      if (height) setActionTrayHeight(Math.ceil(height))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
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
  const { data: liveData, refetch: refetchLive } = useQuery<LiveScores>({
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

  // Priority 2 — Playing Partner selection UI, for groups larger than
  // two. A group of exactly two is auto-paired at Begin Round (unchanged
  // — currentMarked is already populated by the time they reach
  // scoring, so this effect's own condition below never fires for
  // them, satisfying "for 2-player groups, auto-select each other with
  // no extra step" without any special-casing here). null =
  // not yet checked; [] = checked, nothing to choose from (solo group,
  // or everyone else already paired) — both correctly fall through to
  // normal scoring without a marker, exactly like today's existing
  // "no marker assigned" handling elsewhere in this file.
  const [partnerCandidates, setPartnerCandidates] = useState<{ id: string; name: string }[] | null>(null)
  const [selectingPartnerId, setSelectingPartnerId] = useState<string | null>(null)
  const [partnerSelectError, setPartnerSelectError] = useState('')
  useEffect(() => {
    if (!requiresMarker || currentMarked) return
    let cancelled = false
    fetch(`/api/trips/${tripId}/rounds/${round.id}/playing-partner`)
      .then(res => res.ok ? res.json() : null)
      .then(body => { if (!cancelled && body) setPartnerCandidates(body.paired ? [] : (body.candidates ?? [])) })
      .catch(() => { if (!cancelled) setPartnerCandidates([]) }) // fail safe to "nothing to choose" — never blocks scoring
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately re-checks only when currentMarked's presence changes (becomes truthy once chosen, refetched via the existing liveData query), not on every unrelated re-render
  }, [requiresMarker, !!currentMarked, tripId, round.id])

  async function choosePartner(partnerId: string) {
    setSelectingPartnerId(partnerId)
    setPartnerSelectError('')
    try {
      const res = await fetch(`/api/trips/${tripId}/rounds/${round.id}/playing-partner`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partnerId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setPartnerSelectError(body.error ?? "Couldn't set your Playing Partner. Please try again.")
        setSelectingPartnerId(null)
        return
      }
      await refetchLive() // pulls the fresh currentMarked, which clears this screen naturally
    } catch {
      setPartnerSelectError("Couldn't set your Playing Partner. Check your connection and try again.")
      setSelectingPartnerId(null)
    }
  }
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
        if (res.ok) {
          const body = await res.json()
          setHoles(body.holes ?? [])
          setSideComps(body.sideComps ?? [])
        }
      } catch { /* ignore */ }
      setLoadingHoles(false)
    }
    void load()
  }, [tripId, round.id])

  // Seed holeIdx from the resolved starting hole — exactly once, only
  // once both holes and startInfo have actually loaded (guarded by the
  // ref, not by re-running this effect conditionally, which is what
  // makes "exactly once" actually true regardless of render order).
  // Standard rounds and shotgun rounds with no resolved starting hole
  // yet both correctly leave holeIdx at its default 0 (hole 1) —
  // nothing here changes standard-round behaviour at all.
  useEffect(() => {
    if (holeIdxSeededRef.current) return
    if (holes.length === 0 || !startInfo) return
    const resolvedStartHole = startInfo.startType === 'shotgun' ? (startInfo.startingHole ?? pendingStartHolePick) : null
    if (startInfo.startType === 'shotgun' && resolvedStartHole === null) return // waiting on the fallback picker below
    holeIdxSeededRef.current = true
    if (resolvedStartHole !== null) {
      const idx = holes.findIndex(h => h.hole_number === resolvedStartHole)
      if (idx >= 0) setHoleIdx(idx)
    }
  }, [holes, startInfo, pendingStartHolePick])

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
  const distance = hole?.distance ?? null
  // Sprint 9 Item 2 — this hole's active Side Competitions + whether it's
  // the Powerplay hole. Deliberately allows more than one to be true at
  // once (no "one competition per hole" rule yet — left flexible per
  // explicit instruction, not an oversight).
  // Corrected model: Powerplay gets its own dedicated, stronger banner
  // (below) — excluded here so a hole with both Powerplay and, say, NTP
  // configured doesn't show Powerplay twice (once via its own banner,
  // once via this generic loop with a wrong fallback icon/label, since
  // SIDE_COMP_BANNER has no 'powerplay' entry). Every OTHER competition
  // on this hole still renders here, and correctly renders more than one
  // if configured (this is already a .map() over every match, not a
  // .find() that would silently drop a second one).
  const activeSideComps = sideComps.filter(c => c.enabled && c.hole_number === holeNum && c.comp_type !== 'powerplay')
  const powerplayCompsOnHole = sideComps.filter(c => c.enabled && c.hole_number === holeNum && c.comp_type === 'powerplay')
  const isPowerplayHole = powerplayCompsOnHole.length > 0

  // Sync draft state whenever the hole changes (prefer already-saved value if present)
  useEffect(() => {
    const existingMine = mySelf[holeNum]
    setDraftMyGross(existingMine?.grossScore ?? null)
    setDraftMyPickedUp(existingMine?.pickedUp ?? false)
    // P0 fix — Marnie's persisted score in shared-device mode lives in
    // partnerSelf (written as HER OWN capture_role='self' entry via the
    // shared-device-score endpoint — see confirmScore()), never in
    // partnerMarker (that's only ever populated in genuine two-device
    // marker mode, where Alex writes a real marker entry for a digital
    // partner). Reading partnerMarker here for a shared-device pair was
    // the actual root cause of the reported bug: her horizontal
    // scorecard (ExpandableRoundScorecard, fed from partnerSelf) showed
    // her real 25pts, while this draft-rehydration effect looked in the
    // one place her score was never written, so returning to any
    // already-scored hole reset the live panel to 0 even though her
    // official score was correctly persisted the whole time.
    const existingPartner = isSharedDeviceScoring ? partnerSelf[holeNum] : partnerMarker[holeNum]
    setDraftPartnerGross(existingPartner?.grossScore ?? null)
    setDraftPartnerPickedUp(existingPartner?.pickedUp ?? false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeNum])

  const myHcp = currentMy?.playing_handicap ?? 0
  const partnerHcp = currentMarked?.playing_handicap ?? 0
  const myStrokes = hole ? getHandicapStrokesForHole({ playingHandicap: myHcp, strokeIndex: si }) : 0
  const partnerStrokes = hole ? getHandicapStrokesForHole({ playingHandicap: partnerHcp, strokeIndex: si }) : 0

  const myPts = draftMyPickedUp ? 0 : (draftMyGross !== null ? calculateStableford({ grossScore: draftMyGross, par, strokeIndex: si, playingHandicap: myHcp, isPowerplayHole }) : null)
  const partnerPts = draftPartnerPickedUp ? 0 : (draftPartnerGross !== null ? calculateStableford({ grossScore: draftPartnerGross, par, strokeIndex: si, playingHandicap: partnerHcp, isPowerplayHole }) : null)
  // Sprint 9 — the "3 × 2 = 6 pts" breakdown shown in the UI (below) is
  // display-only; myPts/partnerPts above (the actual authoritative
  // client-side preview) already include the ×2 via calculateStableford's
  // own isPowerplayHole parameter, matching the Postgres trigger exactly.
  // These base values exist only to show the "before" half of that
  // breakdown — they are never summed/persisted anywhere themselves.
  const myBasePts = draftMyPickedUp || draftMyGross === null ? null : calculateStableford({ grossScore: draftMyGross, par, strokeIndex: si, playingHandicap: myHcp })
  const partnerBasePts = draftPartnerPickedUp || draftPartnerGross === null ? null : calculateStableford({ grossScore: draftPartnerGross, par, strokeIndex: si, playingHandicap: partnerHcp })

  // myComparison/partnerComparison must react to what's actually on
  // screen right now, not stale saved data — this is the direct fix for
  // the reported "edit the score but the mismatch never clears" dead
  // end. Each card has exactly one side a player can edit here: their
  // own self-entry on "Your Score" (draftMyGross/draftMyPickedUp), or
  // their marker-entry for the partner on "Your Marker"
  // (draftPartnerGross/draftPartnerPickedUp). The other side of each
  // comparison is whatever the other party already submitted — not
  // editable from this screen, so it's still read from the saved
  // capture maps. Previously both sides came from the saved maps,
  // meaning editing the draft changed the number on screen but never
  // touched what compareCaptures actually compared.
  // P0 regression fix — myDraftCapture was previously rebuilt fresh
  // from local editable draft state (draftMyGross/draftMyPickedUp)
  // with no adminOverridden field at all. compareCaptures(myDraftCapture,
  // ...) could therefore never see admin_overridden regardless of what
  // mySelf[holeNum] (the actual underlying data, correctly carrying the
  // flag via splitByRole) contained — myComparison, the value that
  // actually drives every status/panel render decision, silently
  // dropped the flag on every single render. This is the definitive
  // root cause of the reported regression: the earlier compareCaptures/
  // splitByRole fix was correct for the data model, but the value
  // consuming it here was reconstructed from a different, narrower
  // object that never carried the flag through. Threading it from
  // mySelf[holeNum] here fixes the actual render path, not just the
  // underlying data.
  const myDraftCapture: CaptureValue = { grossScore: draftMyPickedUp ? null : draftMyGross, pickedUp: draftMyPickedUp, adminOverridden: mySelf[holeNum]?.adminOverridden }
  const partnerDraftCapture: CaptureValue = { grossScore: draftPartnerPickedUp ? null : draftPartnerGross, pickedUp: draftPartnerPickedUp }
  // P0 fix — same root cause as the Round Summary screen: myMarker is
  // always empty for a shared-device pair, so comparing against it here
  // showed a permanent "pending_marker" badge on Alex's own card while
  // actively scoring, even on a hole neither player had reached yet.
  // No marker relationship exists in this mode, so no per-hole
  // comparison status applies here either.
  const myComparison = (requiresMarker && !isSharedDeviceScoring) ? compareCaptures(myDraftCapture, myMarker[holeNum] ?? null) : null
  // Add-on 1 — shared-device mode never computes a comparison at all.
  // There is exactly one entry for this hole (Alex's own), written
  // directly as the partner's official score — nothing exists to
  // disagree with, so there is no "mismatch" or "matched" state to
  // ever show, unlike a genuine two-independent-entries pairing.
  const partnerComparison = (!isSharedDeviceScoring && requiresMarker && currentMarked) ? compareCaptures(partnerSelf[holeNum] ?? null, partnerDraftCapture) : null

  const myRunningTotal = holes.reduce((sum, h) => {
    const c = mySelf[h.hole_number]
    if (!c || (c.grossScore === null && !c.pickedUp)) return sum
    if (c.pickedUp) return sum
    return sum + calculateStableford({ grossScore: c.grossScore!, par: h.par, strokeIndex: h.stroke_index, playingHandicap: myHcp, isPowerplayHole: powerplayHoleNumbers.has(h.hole_number) })
  }, 0)

  // Same calculation, but for the partner's own card — uses the partner's
  // own captures and their own handicap, not the current user's. Without
  // this, the YOUR MARKER card would show (or risk showing) the wrong
  // player's total if their handicaps differ.
  const partnerRunningTotal = holes.reduce((sum, h) => {
    const c = partnerSelf[h.hole_number]
    if (!c || (c.grossScore === null && !c.pickedUp)) return sum
    if (c.pickedUp) return sum
    return sum + calculateStableford({ grossScore: c.grossScore!, par: h.par, strokeIndex: h.stroke_index, playingHandicap: partnerHcp, isPowerplayHole: powerplayHoleNumbers.has(h.hole_number) })
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

  // Priority 5/7 — non-blocking reconciliation during play. Previously
  // a value here (hasUnresolvedMismatch(myComparison, partnerComparison))
  // also gated per-hole confirmation — meaning queueScoreEntry (the ONLY
  // place a score actually gets persisted, even to the local offline
  // queue) never ran at all while a mismatch was outstanding. On an
  // unreliable course connection, this could mean a player's own entered
  // score was never saved anywhere until the mismatch was resolved,
  // actively blocking real golf over a data-integrity check that has its
  // own correct enforcement point already: isReadyToConfirm, gating the
  // FINAL "Confirm Final Scores" button below (Round Summary), which
  // already correctly requires every hole to be matched before the
  // scorecard can become official. That's the blocking gate per
  // Priority 7 — "during play: non-blocking; final confirmation:
  // blocking" — this was simply being enforced one step too early. The
  // comparison state itself (matched/pending_marker/pending_self/
  // mismatch) is completely unchanged — src/lib/scoring/comparison.ts
  // already models exactly the three situations the brief describes
  // (matched, sync pending, reconciliation required); only the
  // ENFORCEMENT point moves.
  //
  // P0 fix — this file previously still had a leftover
  // `const hasBlockingMismatch = hasUnresolvedMismatch(...)` declaration
  // sitting directly above this comment: the earlier reconciliation
  // change removed hasUnresolvedMismatch from the import statement
  // (correctly believing the whole variable was gone), but missed that
  // the declaration line itself was still present, now calling a
  // function that no longer existed in scope. That's a genuine
  // ReferenceError ("hasUnresolvedMismatch is not defined") thrown on
  // every single render of this component — not conditional on any
  // specific data state, which is exactly why it reproduced 100% of
  // the time regardless of group size, marker status, or anything else
  // investigated. Removed entirely — hasBlockingMismatch itself was
  // already unused anywhere else in this file, confirmed by search.
  const canConfirm = !isLocked && (draftMyGross !== null || draftMyPickedUp)
    && (!requiresMarker || !currentMarked || draftPartnerGross !== null || draftPartnerPickedUp)

  async function confirmScore() {
    if (!canConfirm || !hole || !currentMy || confirmingRef.current) return
    confirmingRef.current = true
    setFlash(true)

    // P0 regression fix — same bug class as myDraftCapture: this
    // optimistic local update previously rebuilt the hole's entry
    // without adminOverridden, which would silently drop the flag from
    // mySelf state for this specific hole the moment confirmScore ran
    // again on it. Preserved from the existing prev state rather than
    // re-derived, since this function has no reason to know or assume
    // anything about override status — it's just not losing data that
    // was already there.
    const myValue: CaptureValue = { grossScore: draftMyPickedUp ? null : draftMyGross, pickedUp: draftMyPickedUp, adminOverridden: mySelf[holeNum]?.adminOverridden }
    setMySelf(prev => ({ ...prev, [holeNum]: myValue }))
    if (requiresMarker && currentMarked) {
      const partnerValue: CaptureValue = { grossScore: draftPartnerPickedUp ? null : draftPartnerGross, pickedUp: draftPartnerPickedUp }
      setPartnerMarker(prev => ({ ...prev, [holeNum]: partnerValue }))
    }

    // Shotgun Start — "last array position" means nothing in a circular
    // sequence, so it's no longer what decides whether to advance or
    // stop. The SEPARATE allDone check elsewhere in this file (watches
    // captured scores directly, holes.every(...) — already genuinely
    // order-independent, confirmed unchanged) is what actually triggers
    // Round Summary once every hole is truly done, for both standard
    // and shotgun rounds alike. This auto-advance just always moves to
    // the next hole for shotgun (wrapping circularly); for standard
    // rounds the exact original "stop at the last hole" behaviour is
    // preserved untouched.
    const isShotgunRound = startInfo?.startType === 'shotgun'
    const isLastHole = !isShotgunRound && holeIdx >= holes.length - 1
    setTimeout(() => {
      if (isShotgunRound) {
        setHoleIdx(i => (i + 1) % holes.length)
      } else if (!isLastHole) {
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
        if (isSharedDeviceScoring) {
          // Add-on 1 (corrected architecture) — Marnie's OFFICIAL score,
          // written via applyHoleOverride (through this endpoint) as
          // capture_role='self' directly on her own scorecard. This is
          // deliberately NOT the normal queueScoreEntry(captureRole=
          // 'marker') call below — a marker write would need a
          // corresponding self entry from Marnie to ever reconcile
          // against, which never comes, since she isn't digitally
          // scoring at all. This IS what makes "no reconciliation
          // required" true, by construction rather than a suppressed
          // check.
          const res = await fetch(`/api/trips/${tripId}/rounds/${round.id}/shared-device-score`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ holeNumber: hole.hole_number, grossScore: draftPartnerPickedUp ? null : draftPartnerGross, isNoReturn: draftPartnerPickedUp }),
          })
          if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            showToast(body.error ?? `Couldn't save ${partnerName ?? 'their'} score. Please try again.`)
          }
        } else {
          await queueScoreEntry({
            scorecardId: currentMarked.id, holeId: hole.id, captureRole: 'marker',
            grossScore: draftPartnerPickedUp ? null : draftPartnerGross, isNoReturn: draftPartnerPickedUp,
            enteredAt: new Date().toISOString(),
          })
        }
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
    // Shotgun Start — circular wrap, only for shotgun rounds. Standard
    // rounds keep the exact original clamped-at-bounds behaviour
    // (startInfo?.startType !== 'shotgun' is true both before startInfo
    // has loaded and for genuinely standard rounds — safe default
    // either way, since clamped is what every round already does today).
    const isShotgun = startInfo?.startType === 'shotgun'
    if (isShotgun) {
      if (dx < 0) setHoleIdx(h => (h + 1) % holes.length)
      if (dx > 0) setHoleIdx(h => (h - 1 + holes.length) % holes.length)
    } else {
      if (dx < 0 && holeIdx < holes.length - 1) setHoleIdx(h => h + 1)
      if (dx > 0 && holeIdx > 0) setHoleIdx(h => h - 1)
    }
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
  // Shotgun Start fallback picker — takes priority over even the
  // Playing Partner gate below, since a player needs to know where
  // they're starting before anything else makes sense. Only ever shown
  // when the round is genuinely shotgun AND no organiser assignment
  // exists for this player's group — an assigned group, and every
  // standard round, skip this entirely (holeIdx was already seeded
  // correctly, or correctly left at 0).
  if (startInfo?.startType === 'shotgun' && startInfo.startingHole === null && pendingStartHolePick === null && holes.length > 0) {
    return (
      <div style={{ minHeight: '100vh', background: '#faf9f6', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '24px 20px' }}>
        <div style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 19, fontWeight: 800, marginBottom: 6, textAlign: 'center' }}>
          What hole are you starting on?
        </div>
        <div style={{ fontFamily: 'var(--font-body)', color: '#7a7260', fontSize: 13, marginBottom: 20, textAlign: 'center' }}>
          This is a shotgun start — your organiser hasn&apos;t assigned your group a hole yet.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
          {holes.map(h => (
            <button
              key={h.hole_number}
              onClick={() => setPendingStartHolePick(h.hole_number)}
              style={{
                padding: '12px 0', borderRadius: 10, border: h.hole_number === 1 ? '1.5px solid #1a4731' : '1.5px solid #d9c9a3',
                background: h.hole_number === 1 ? '#1a4731' : '#ffffff', color: h.hole_number === 1 ? '#fff' : '#14532d',
                fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, cursor: 'pointer',
              }}
            >
              {h.hole_number}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // Priority 2 — the actual selection screen. Placed before the
  // reconciliation branch below: a player with no partner yet can't
  // meaningfully reach Round Summary's comparison (there's nothing to
  // compare against), so this takes priority. Never shown for a 2-
  // player group (currentMarked already set by then) or a solo group
  // (partnerCandidates resolves to [], falling straight through to
  // normal scoring below, unchanged).
  if (requiresMarker && !currentMarked && partnerCandidates && partnerCandidates.length > 0) {
    return (
      <div style={{ minHeight: '100vh', background: '#faf9f6', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '24px 20px' }}>
        <div style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 19, fontWeight: 800, marginBottom: 6, textAlign: 'center' }}>
          Choose your Playing Partner
        </div>
        <div style={{ fontFamily: 'var(--font-body)', color: '#7a7260', fontSize: 13, marginBottom: 20, textAlign: 'center' }}>
          You&apos;ll record your own score and theirs — they&apos;ll do the same for you.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {partnerCandidates.map(c => (
            <button
              key={c.id}
              onClick={() => void choosePartner(c.id)}
              disabled={selectingPartnerId !== null}
              style={{
                padding: '14px 16px', borderRadius: 12, border: '1.5px solid #d9c9a3', background: '#ffffff',
                fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 700, color: '#14532d',
                cursor: selectingPartnerId ? 'default' : 'pointer', opacity: selectingPartnerId && selectingPartnerId !== c.id ? 0.5 : 1,
                textAlign: 'left',
              }}
            >
              {selectingPartnerId === c.id ? '…' : c.name}
            </button>
          ))}
        </div>
        {partnerSelectError && <p style={{ color: '#dc2626', fontSize: 12.5, marginTop: 12, fontFamily: 'var(--font-body)', textAlign: 'center' }}>{partnerSelectError}</p>}
      </div>
    )
  }

  if (showReconciliation) {
    const PENDING: ComparisonStatus[] = ['pending_marker', 'pending_self', 'not_started']

    const rows = holes.map(h => {
      // P0 fix — shared-device pairs never write marker entries at all
      // (Marnie's official score is written as HER OWN capture_role='self'
      // entry via the shared-device-score endpoint, not as a marker entry
      // on Alex's card — see confirmScore()/isSharedDeviceScoring above).
      // Comparing mySelf against myMarker here always found myMarker
      // empty for this mode and reported 'pending_marker' on every hole,
      // which is the actual root cause of the reported "0 matched / 9
      // waiting" state: there was never a marker entry to wait for in the
      // first place. Completeness for a shared-device pair is instead:
      // does Alex's own entry exist, and does Marnie's own entry
      // (partnerSelf) exist, for this hole — reusing the same
      // ComparisonStatus values so every downstream computation below
      // (mismatches/pending/detailedSummaryRows/allMatched/
      // isReadyToConfirm) keeps working unchanged, off one canonical
      // per-hole status instead of a second parallel rule.
      const mineStatus: ComparisonStatus = isSharedDeviceScoring
        ? (mySelf[h.hole_number] && partnerSelf[h.hole_number] ? 'matched'
            : mySelf[h.hole_number] ? 'pending_marker'
            : partnerSelf[h.hole_number] ? 'pending_self'
            : 'not_started')
        : compareCaptures(mySelf[h.hole_number] ?? null, myMarker[h.hole_number] ?? null)
      // Only meaningful when there's actually a partner card to mark —
      // requiresMarker is false in individual mode, and currentMarked can be
      // null even in self_and_marker mode if no partner is assigned yet.
      // Shared-device pairs never have a second, independent marker
      // comparison to make (there is no marker relationship at all in
      // this mode), so partnerStatus stays null — mineStatus above
      // already captures the pair's full completeness state.
      const partnerStatus = (requiresMarker && currentMarked && !isSharedDeviceScoring)
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
        ? calculateStableford({ grossScore: myCapture.grossScore, par: h.par, strokeIndex: h.stroke_index, playingHandicap: myHcp, isPowerplayHole: powerplayHoleNumbers.has(h.hole_number) })
        : (myCapture?.pickedUp ? 0 : null)
      return { hole: h, status, gross, pts }
    })
    const outHoles = detailedSummaryRows.filter(r => r.hole.hole_number <= 9)
    const inHoles = detailedSummaryRows.filter(r => r.hole.hole_number > 9)
    const sumPts = (rs: typeof detailedSummaryRows) => rs.reduce((s, r) => s + (r.pts ?? 0), 0)
    const outTotal = sumPts(outHoles)
    const inTotal = sumPts(inHoles)
    const allMatched = detailedSummaryRows.every(r => r.status === 'matched')
    // Bug 1 — the single canonical readiness result. allMatched alone
    // only reflects local, per-hole comparison state; confirmScore()
    // updates that local state synchronously, while the actual sync to
    // the server (queueScoreEntry -> syncScoreQueue) is a separate,
    // un-awaited operation that can still be in flight. The server's own
    // submit check queries the database directly and correctly requires
    // every hole to actually be persisted there — which is exactly why
    // it could disagree with a client that had already moved on to
    // showing "ready." Folding pendingCount into this one readiness
    // value is what makes the summary, the button, and the server check
    // agree: the client cannot claim ready while sync is still pending.
    const isReadyToConfirm = allMatched && pendingCount === 0
    const STATUS_ICON: Record<string, { icon: string; color: string }> = {
      matched:      { icon: '🟢', color: '#16a34a' },
      mismatch:     { icon: '🔴', color: '#dc2626' },
      awaiting:     { icon: '🟡', color: '#a1791f' },
      not_started:  { icon: '⚪', color: '#d1d5db' },
    }

    const grandTotal = outTotal + inTotal

    // Package 1 — the marker's own independently-recorded total, using
    // the exact same calculateStableford call as the player's own total
    // above, just fed myMarker's captures instead of mySelf's. Only
    // meaningful in self_and_marker mode with an actual marker assigned
    // — requiresMarker/currentMarked guard this exactly like every other
    // marker-dependent value on this screen already does. Never used in
    // shared-device mode (see partnerGrandTotal below) — myMarker is
    // always empty there, which previously made this show a permanent
    // false "0 pts / holes to review" comparison against Marnie.
    const markerGrandTotal = (requiresMarker && currentMarked && !isSharedDeviceScoring)
      ? holes.reduce((sum, h) => {
          const markerCapture = myMarker[h.hole_number] ?? null
          if (!markerCapture) return sum
          const pts = markerCapture.pickedUp ? 0
            : markerCapture.grossScore !== null
              ? calculateStableford({ grossScore: markerCapture.grossScore, par: h.par, strokeIndex: h.stroke_index, playingHandicap: myHcp, isPowerplayHole: powerplayHoleNumbers.has(h.hole_number) })
              : 0
          return sum + pts
        }, 0)
      : null

    // P0 fix — Marnie's REAL, independently-entered total for a
    // shared-device pair, computed from partnerSelf (her own official
    // capture_role='self' entries), not from a marker copy that never
    // exists in this mode. This is not a comparison/reconciliation value
    // — a shared-device pair has nothing to reconcile — it's just her
    // actual points, shown alongside Alex's for information.
    const partnerGrandTotal = (isSharedDeviceScoring && currentMarked)
      ? holes.reduce((sum, h) => {
          const partnerCapture = partnerSelf[h.hole_number] ?? null
          if (!partnerCapture) return sum
          const pts = partnerCapture.pickedUp ? 0
            : partnerCapture.grossScore !== null
              ? calculateStableford({ grossScore: partnerCapture.grossScore, par: h.par, strokeIndex: h.stroke_index, playingHandicap: partnerHcp, isPowerplayHole: powerplayHoleNumbers.has(h.hole_number) })
              : 0
          return sum + pts
        }, 0)
      : null

    return (
      <div style={{ minHeight: '100vh', background: '#faf9f6', padding: '12px 16px 90px' }}>
        <div style={{ textAlign: 'center', marginBottom: 2 }}>
          <div style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 17, fontWeight: 800 }}>Round Summary</div>
          <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, color: '#14532d', marginTop: 2 }}>{myName}</div>
          <div style={{ fontFamily: 'var(--font-body)', color: '#6b7280', fontSize: 11, marginTop: 1 }}>
            {isSharedDeviceScoring
              ? (allMatched ? 'Shared-device scoring complete ✓' : `${rows.length - pending.length} of ${rows.length} holes recorded`)
              : <>{rows.length - mismatches.length - pending.length} holes matched · {mismatches.length} need review{pending.length > 0 ? ` · ${pending.length} waiting` : ''}</>}
          </div>
          <div style={{ fontFamily: 'var(--font-display)', color: '#a1791f', fontSize: 20, fontWeight: 800, marginTop: 6 }}>
            {grandTotal} pts
          </div>
        </div>

        {/* Package 3 (C2) — this comparison is only shown while
            reconciliation is genuinely still in progress (!isLocked).
            Previously this block had no isLocked gate at all — it kept
            showing myName vs partnerName side-by-side even on an
            already-completed, fully-verified round, continuing to
            present the marker's copy as an equal competing result
            indefinitely. Once locked, the simplified "Scorecard
            Verified" block below takes over instead — marker data
            itself is untouched and still exists for audit purposes,
            it just no longer dominates the completed screen. */}
        {requiresMarker && currentMarked && markerGrandTotal !== null && !isLocked && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-around',
            background: '#fff', border: '1px solid #eceae3', borderRadius: 12, padding: '12px 14px', marginTop: 10,
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.4 }}>{myName}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: '#14532d', marginTop: 2 }}>{grandTotal}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              {grandTotal === markerGrandTotal ? (
                <>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 18 }}>✓</div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#16a34a' }}>Matched</div>
                </>
              ) : (
                <>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 18 }}>⚠</div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#dc2626' }}>{mismatches.length} hole{mismatches.length === 1 ? '' : 's'} to review</div>
                </>
              )}
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.4 }}>{partnerName ?? 'Playing Partner'}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: '#14532d', marginTop: 2 }}>{markerGrandTotal}</div>
            </div>
          </div>
        )}

        {/* P0 fix — the shared-device equivalent of the card above, but
            deliberately NOT framed as a match/mismatch comparison: a
            shared-device pair has no independent second entry to
            reconcile against (Marnie's total here is her own real,
            official score, not a marker copy of Alex's), so there is
            nothing to flag as "needing review" just because the two
            totals differ, which they normally will. */}
        {isSharedDeviceScoring && currentMarked && partnerGrandTotal !== null && !isLocked && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-around',
            background: '#fff', border: '1px solid #eceae3', borderRadius: 12, padding: '12px 14px', marginTop: 10,
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.4 }}>{myName}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: '#14532d', marginTop: 2 }}>{grandTotal}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 18 }}>{allMatched ? '✓' : '⏳'}</div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: allMatched ? '#16a34a' : '#a1791f' }}>
                {allMatched ? 'Shared-device' : 'Scoring in progress'}
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.4 }}>{partnerName ?? 'Paper Player'}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: '#14532d', marginTop: 2 }}>{partnerGrandTotal}</div>
            </div>
          </div>
        )}

        {/* Package 3 (C2) — the simplified, official post-reconciliation
            view. grandTotal here is the exact same value the comparison
            block above already used — the player's own capture_role
            'self' entries, which is also what the leaderboard,
            cumulative totals, and every other downstream reader already
            treats as authoritative (confirmed by inspection, not a new
            convention introduced here). Marker data remains fully
            intact underneath (visible via "Review holes" below) for
            audit purposes; it's simply no longer presented as an equal,
            ongoing comparison once the round is locked. */}
        {isLocked && (
          <div style={{
            textAlign: 'center', background: '#f0fdf4', border: '1px solid #bbf7d0',
            borderRadius: 12, padding: '16px 14px', marginTop: 10,
          }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#166534' }}>
              ✓ Scorecard Verified
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#4b5563', marginTop: 4 }}>
              {holes.length} holes
            </div>
          </div>
        )}

        {/* Status block — three distinct states per the exact spec:
            mismatches remain, ready to confirm, or already locked.
            Shared-device pairs can never land in the mismatch branch
            (mismatches is always empty for them — see mineStatus fix
            above), so if they're here it's genuinely just "not every
            hole is recorded yet," not "needs review." */}
        {!allMatched && !isLocked && isSharedDeviceScoring && (
          <div style={{ background: '#fffbeb', border: '1.5px solid #fde68a', borderRadius: 12, padding: 14, marginTop: 10, marginBottom: 16 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#a1791f', marginBottom: 6 }}>
              Still recording holes for {myName} and {partnerName ?? 'your paper partner'}.
            </div>
            <button
              onClick={() => setShowReconciliation(false)}
              style={{ width: '100%', padding: 12, borderRadius: 10, border: 'none', background: '#a1791f', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
            >
              Back to Scoring
            </button>
          </div>
        )}

        {!allMatched && !isLocked && !isSharedDeviceScoring && (
          <div style={{ background: '#fef2f2', border: '1.5px solid #fca5a5', borderRadius: 12, padding: 14, marginTop: 10, marginBottom: 16 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#dc2626', marginBottom: 6 }}>
              Scores still need review.
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#7f1d1d', marginBottom: 10 }}>
              Hole{mismatches.length === 1 ? '' : 's'}: {mismatches.map(m => m.hole.hole_number).join(', ')}
            </div>
            <button
              onClick={() => {
                const firstMismatchHole = mismatches[0]?.hole.hole_number
                if (firstMismatchHole) {
                  const idx = holes.findIndex(h => h.hole_number === firstMismatchHole)
                  if (idx >= 0) setHoleIdx(idx)
                }
                setShowReconciliation(false)
              }}
              style={{ width: '100%', padding: 12, borderRadius: 10, border: 'none', background: '#dc2626', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
            >
              Review Scoring Errors
            </button>
          </div>
        )}

        {allMatched && !isReadyToConfirm && !isLocked && (
          <div style={{ background: '#fffbeb', border: '1.5px solid #fde68a', borderRadius: 12, padding: 14, marginTop: 10, marginBottom: 16, textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, color: '#a1791f', marginBottom: 4 }}>
              Saving your scores…
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#6b7280' }}>
              {pendingCount} score{pendingCount === 1 ? '' : 's'} still syncing. You&apos;ll be able to confirm once everything&apos;s saved.
            </div>
          </div>
        )}

        {isReadyToConfirm && !isLocked && (
          <div style={{ background: '#ffffff', border: '1.5px solid #14532d', borderRadius: 12, padding: 14, marginTop: 10, marginBottom: 16, textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, color: '#14532d', marginBottom: 4 }}>
              Your scorecard is ready.
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#374151', marginBottom: 10, lineHeight: 1.5 }}>
              {isSharedDeviceScoring
                ? 'Shared-device scoring complete. Review both scorecards carefully before confirming.'
                : 'All holes are complete and matched. Review your scorecard carefully before confirming.'}
            </div>
            {submitFinalError && <p style={{ color: '#dc2626', fontSize: 11.5, marginBottom: 8, fontFamily: 'var(--font-body)' }}>{submitFinalError}</p>}
            <button
              onClick={() => setShowConfirmModal(true)}
              style={{
                width: '100%', padding: 13, borderRadius: 10, border: 'none', marginBottom: 8,
                background: 'linear-gradient(135deg,#2d7a52,#16a34a)',
                color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, cursor: 'pointer',
              }}
            >
              ✓ Confirm Final Scores
            </button>
            <button
              onClick={() => setShowReconciliation(false)}
              style={{ width: '100%', padding: 10, borderRadius: 10, border: '1px solid #d1d5db', background: '#ffffff', color: '#6b7280', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
            >
              Back to Scoring
            </button>
          </div>
        )}

        {/* Bug 3/4 (field-test corrective) — previously one identical
            block for every role: generic "Results submitted...
            Waiting for the organiser to announce the results," with no
            next action for the organiser at all (they had to know
            independently to go find My HQ) and wording for the player
            that undersold what had actually happened. Split by role:
            the organiser gets an explicit CTA into the exact next step
            (My HQ, to review and close the round — this never closes
            it automatically, the organiser still explicitly does that
            from My HQ, per the explicit "do not automatically close
            the round" instruction); the player gets the brief's exact
            wording for the post-submission waiting state. Ordinary
            navigation (bottom nav — Leaderboard, Side Games, My Golf,
            Chat) is completely unaffected by this block either way,
            since this is just content within the existing scoring
            page, not a modal or a redirect. */}
        {isLocked && isOrganiser && (
          <div style={{ background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: 12, padding: 14, marginTop: 10, marginBottom: 16, textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, color: '#16a34a', marginBottom: 4 }}>
              ✅ Results submitted
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#6b7280', lineHeight: 1.5, marginBottom: 12 }}>
              All scores are reconciled. Go to My HQ to review and close the round.
            </div>
            <Link
              href={`/trips/${tripId}/tournament`}
              style={{
                display: 'inline-block', padding: '10px 20px', borderRadius: 10,
                background: 'linear-gradient(135deg,#2d7a52,#16a34a)', color: '#fff',
                fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, textDecoration: 'none',
              }}
            >
              Go to My HQ →
            </Link>
          </div>
        )}

        {isLocked && !isOrganiser && (
          <div style={{ background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: 12, padding: 14, marginTop: 10, marginBottom: 16, textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, color: '#16a34a', marginBottom: 4 }}>
              🏁 {round.name} Complete
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#6b7280', lineHeight: 1.5 }}>
              Your scorecard has been submitted.
              Waiting for the organiser to publish the final results.
            </div>
          </div>
        )}

        {/* Confirmation modal — a deliberate second step before locking,
            per the explicit requirement not to lock scores from a single
            tap. */}
        {showConfirmModal && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(15,45,28,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div style={{ background: '#ffffff', borderRadius: 14, padding: 20, maxWidth: 340, width: '100%' }}>
              <div style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 16, fontWeight: 800, marginBottom: 8 }}>
                Confirm final scores?
              </div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#374151', lineHeight: 1.5, marginBottom: 16 }}>
                Once confirmed, your scorecard will be locked. Any later correction will require organiser approval.
              </div>
              {submitFinalError && <p style={{ color: '#dc2626', fontSize: 11.5, marginBottom: 10, fontFamily: 'var(--font-body)' }}>{submitFinalError}</p>}
              <button
                onClick={submitFinalScores}
                disabled={submittingFinal}
                style={{
                  width: '100%', padding: 12, borderRadius: 10, border: 'none', marginBottom: 8,
                  background: submittingFinal ? '#9ca3af' : 'linear-gradient(135deg,#2d7a52,#16a34a)',
                  color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14,
                  cursor: submittingFinal ? 'default' : 'pointer',
                }}
              >
                {submittingFinal ? 'Finalising…' : 'Confirm & Lock Scores'}
              </button>
              <button
                onClick={() => { setShowConfirmModal(false); setSubmitFinalError('') }}
                disabled={submittingFinal}
                style={{ width: '100%', padding: 10, borderRadius: 10, border: '1px solid #d1d5db', background: '#ffffff', color: '#6b7280', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              >
                Go Back
              </button>
            </div>
          </div>
        )}

        {/* Full scorecard table — Hole / Par / Gross / Stableford / Status,
            with OUT/IN/TOTAL subtotals. Tap any row to jump to that hole. */}
        <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden', marginBottom: 16 }}>
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
          {outHoles.length > 0 && <SubtotalRow label="OUT" value={outTotal} />}
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
                    {isZeroPointsMismatch(r.mine, r.myMarkerVal, { par: r.hole.par, strokeIndex: r.hole.stroke_index, selfHandicap: myHcp, markerHandicap: partnerHcp }) && (
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#a1791f', marginBottom: 4 }}>
                        Both entries score 0 points — confirm score entry.
                      </div>
                    )}
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
                    {isZeroPointsMismatch(r.partnerSelfVal, r.partnerMarkerVal, { par: r.hole.par, strokeIndex: r.hole.stroke_index, selfHandicap: partnerHcp, markerHandicap: myHcp }) && (
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#a1791f', marginBottom: 4 }}>
                        Both entries score 0 points — confirm score entry.
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 16, fontFamily: 'var(--font-body)', fontSize: 13, color: '#14532d' }}>
                      <div>{partnerName ?? 'Partner'}&apos;s score: <strong>{r.partnerSelfVal?.pickedUp ? 'Pick-up' : r.partnerSelfVal?.grossScore ?? '—'}</strong></div>
                      <div>Your Playing Partner&apos;s entry: <strong>{r.partnerMarkerVal?.pickedUp ? 'Pick-up' : r.partnerMarkerVal?.grossScore ?? '—'}</strong></div>
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
      style={{ display: 'flex', flexDirection: 'column', background: '#ffffff', minHeight: '100vh' }}
    >
      {/* Simplified scoring focus header — only the two things that
          matter while standing on the fairway: a way out, and which
          hole this is. Round name and sync-pending text removed
          entirely (secondary information); sync status moves to a
          small icon beside Confirm Score instead, where it's relevant
          at the exact moment it matters. */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 30,
        paddingTop: 'env(safe-area-inset-top, 0px)',
        background: 'linear-gradient(135deg, #0f2d1c, #1a4731)',
        borderBottom: '2px solid #c9a84c',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          height: 44, padding: '0 14px',
        }}>
        <Link
          href={`/trips/${tripId}`}
          style={{ color: '#f5e6b8', textDecoration: 'none', fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 700 }}
        >
          ✕ Exit
        </Link>
        <div style={{ textAlign: 'right', lineHeight: 1.15 }}>
          <div style={{ color: '#f5e6b8', fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 800, letterSpacing: 0.3 }}>
            HOLE {holeNum}
          </div>
          <div style={{ color: 'rgba(245,230,184,0.75)', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600 }}>
            {distance != null ? `${distance}m · ` : ''}Par {par} · SI {si}
          </div>
        </div>
        </div>
      </div>

      {toast && (
        <div style={{ position: 'fixed', top: 'calc(52px + env(safe-area-inset-top, 0px))', left: '50%', transform: 'translateX(-50%)', zIndex: 200, background: 'rgba(10,30,18,0.97)', border: '1px solid rgba(201,168,76,0.66)', borderRadius: 22, padding: '8px 18px' }}>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#e8c96a', fontWeight: 700 }}>● {toast}</span>
        </div>
      )}

      {/* Compact-spacing aids on short viewports — no longer paired with
          any position/overflow override, since the page is now always in
          normal document flow regardless of viewport height. */}
      <style>{`
        @media (max-height: 800px) {
          .scoring-card-header { padding: 4px 10px !important; }
          .scoring-card-body { padding: 6px 10px !important; }
        }
        @media (max-height: 700px) {
          .scoring-card-header { padding: 3px 8px !important; }
          .scoring-card-body { padding: 5px 8px !important; }
        }
      `}</style>

      {/* Normal document flow — the actual architectural correction.
          No fixed positioning, no calculated viewport height, no grid
          row allocations, no clipping. The scorecards render at their
          natural full height; the page itself scrolls when content is
          taller than the viewport, exactly like any other page. Bottom
          padding here is sized to clear the sticky action tray below
          (its own height plus the bottom nav it sits above), so the
          second scorecard is never hidden behind it. */}
      {/* Always normal, scrollable document flow — collapsed and
          expanded modes are now identical in mechanism. The previous
          position:fixed + overflow:hidden bounded region for collapsed
          mode was confirmed, on a real smaller/older phone, to clip
          content with no way to reach it — exactly the failure mode a
          fixed, non-scrollable region risks whenever content doesn't
          fit the available height. Every control must be reachable on
          every phone size, which a normal scrolling page guarantees
          regardless of content height, screen size, or font scaling —
          a static resting position is no longer worth that risk. */}
      <div
        ref={scrollContainerRef}
        onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
        style={{
          // P0 fix (white-space) — this used to be the bottom-most
          // section, so its own 100px bottom padding (reserved to clear
          // the fixed action tray) made sense here. It no longer is: the
          // side-game banners, both score panels, and everything else
          // below all render as later siblings, so this 100px sat
          // between Alex's collapsed scorecard toggle and the next
          // section regardless of what that next section was — a large
          // fixed gap in the middle of the page, not at the bottom of
          // it. Reduced to a small, consistent 12px so this section
          // just breathes normally into whatever follows; the actual
          // 100px tray-clearance moves to the real last section, below.
          padding: 'calc(48px + env(safe-area-inset-top, 0px)) 16px 12px',
          background: '#faf9f6',
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
        {/* Follow-up UX pass — the previously-inline compact score strip
            is now ExpandableRoundScorecard, a genuine reusable
            component (extracted verbatim, same tiles/colours/layout),
            so shared-device mode can mount a second, independent
            instance for the paper player below. Alex's own instance is
            completely unchanged in behaviour: setHoleIdx is still the
            same shared navigation function, mySelf/myHcp are still the
            same data this shell already had in scope. */}
        <ExpandableRoundScorecard
          label="Round Scorecard"
          holes={holes}
          holeIdx={holeIdx}
          onSelectHole={setHoleIdx}
          captureByHole={mySelf}
          playingHandicap={myHcp}
          powerplayHoleNumbers={powerplayHoleNumbers}
          sideCompHoleNumbers={new Set(sideComps.filter(c => c.enabled).map(c => c.hole_number))}
          expanded={scorecardExpanded}
          onToggle={() => {
            const willExpand = !scorecardExpanded
            setScorecardExpanded(willExpand)
            if (willExpand) {
              // Same scroll nudge as before extraction — preserved
              // exactly, since this is presentation-only behaviour, not
              // completion/reconciliation logic.
              requestAnimationFrame(() => {
                window.scrollBy({ top: -140, behavior: 'smooth' })
              })
            }
          }}
          footerNote={!scorecardExpanded && currentMarkedByName ? `Playing Partner: ${currentMarkedByName}` : (scorecardExpanded && currentMarkedByName ? `Playing Partner: ${currentMarkedByName}` : null)}
        />

        </div>

        {/* ── Sprint 9 Item 2 — competition-hole announcement banners.
            Inline/banner treatment, not a blocking modal — the golfer
            sees this and can still scroll straight past it into scoring.
            No result entry here yet (Item 3); this is awareness only.
            Powerplay gets the stronger, distinct treatment the brief
            asks for (deeper gold, "DOUBLE STABLEFORD POINTS"), separate
            from the Side Competition banners. ───────────────────────── */}
        {isPowerplayHole && (
          <div style={{
            background: 'linear-gradient(135deg,#7a5c00,#a1791f)', borderRadius: 12,
            padding: '12px 14px', marginBottom: 10, textAlign: 'center',
            boxShadow: '0 3px 12px rgba(161,121,31,0.35)',
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
            background: '#fdf3d9', border: '1.5px solid #e8c96a', borderRadius: 12,
            padding: '10px 14px', marginBottom: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
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
            <SideCompEntryPanel
              tripId={tripId} sideCompId={comp.id} compType={comp.comp_type}
              label={SIDE_COMP_BANNER[comp.comp_type]?.label ?? 'Side Competition'}
              icon={SIDE_COMP_BANNER[comp.comp_type]?.icon ?? '🎯'}
              currentUserId={currentMy?.player_id ?? ''}
              // Side Games proxy entry — this shell only ever has two
              // players in scope (self + marker), so the full "playing
              // group" the brief describes for a 3-4 player group_scorer
              // round isn't representable here; only self and the one
              // partner being marked. Genuinely useful as far as it
              // goes (self_and_marker rounds are still the majority
              // case), but this is not the primary scenario the brief's
              // own worked example describes (a non-digital THIRD
              // player in a larger group) — that requires the same
              // wiring in ScoreSessionShell.tsx (group_scorer mode),
              // which does not call SideCompEntryPanel at all currently
              // and was not reached in this pass. Only includes the
              // partner when one genuinely exists (requiresMarker &&
              // currentMarked) — a solo self_and_marker round with no
              // partner yet sees no selector at all, identical to
              // before this feature.
              groupMembers={
                fullGroupRoster.length > 0
                  ? fullGroupRoster
                  : (requiresMarker && currentMarked && currentMy
                      ? [{ id: currentMy.player_id, name: myName }, { id: currentMarked.player_id, name: partnerName ?? 'Your Playing Partner' }]
                      : [])
              }
              roundId={round.id} holeNumber={holeNum}
              // Stage 2 — the one and only place newLeaderPrompt is ever
              // set. onWouldLeadIfVerified only fires from a direct POST
              // response (see SideCompEntryPanel), so this can only ever
              // happen as an immediate reaction to the golfer's own
              // submission — never from a background refetch. Uses the
              // claim's own claimedValue, not currentLeader (which is
              // explicitly the OFFICIAL/verified leader — a different
              // person at this point, since this claim is still pending).
              onWouldLeadIfVerified={(result) => {
                setNewLeaderPrompt({
                  tripId, roundId: round.id, holeNumber: holeNum, myGroupId: null,
                  sideCompId: comp.id, compType: comp.comp_type,
                  entryId: result.entryId,
                  playerName: myName, claimedValue: result.claimedValue,
                })
              }}
            />
            {newLeaderPrompt && newLeaderPrompt.sideCompId === comp.id && (
              <div style={{ marginTop: 10 }}>
                <NewLeaderPrompt ctx={newLeaderPrompt} onDismiss={() => setNewLeaderPrompt(null)} />
              </div>
            )}
          </div>
        ))}

        {/* Side Game Marker Verification Stage 3 — non-blocking, appears
            once per screen (not per hole), collapsed by default. Normal
            hole-by-hole scoring below remains completely uninterrupted
            whether or not this marker has anything to verify. */}
        <PendingVerificationCard tripId={tripId} roundId={round.id} />

        {/* Scoring Anchor — the permanent resting point every hole
            transition returns to. Same simple normal-flow wrapper in
            both modes now — cards render at their natural height and
            the page scrolls if they don't fit, rather than being forced
            into a fixed region that could clip them. */}
        <div
          ref={scoringAnchorRef}
          style={{ display: 'flex', flexDirection: 'column' }}
        >
        {/* ── Card 1: MY SCORE ───────────────────────────────────────────── */}
        <ScoreCard
          title="MY SCORE" name={myName} hcp={myHcp} par={par} si={si} strokes={myStrokes} holeNum={holeNum} distance={distance}
          gross={draftMyGross} pickedUp={draftMyPickedUp} pts={myPts} runningTotal={myRunningTotal}
          onPick={d => pick('mine', d)} onPar={() => pickPar('mine')} onTogglePickUp={() => togglePickUp('mine')}
          status={myComparison} onOpenSummary={() => setShowReconciliation(true)} isLockedForSide={isLocked}
          activeSideComps={activeSideComps} isPowerplayHole={isPowerplayHole} basePts={myBasePts}
        />

        {/* P0 fix (shared-device layout) — Marnie's own, independently
            expandable scorecard, relocated to sit immediately above her
            own scoring panel (Card 2 below) rather than beside Alex's at
            the top of the page. Only rendered in shared-device mode; a
            normal digital partner never sees this second strip at all
            (they have their own device/screen for that). Same
            ExpandableRoundScorecard component, same partnerSelf/
            partnerHcp data this shell already reads — not a duplicate
            component, just moved. */}
        {isSharedDeviceScoring && partnerName && (
          <ExpandableRoundScorecard
            label={`${partnerName}'s Scorecard`}
            holes={holes}
            holeIdx={holeIdx}
            onSelectHole={setHoleIdx}
            captureByHole={partnerSelf}
            playingHandicap={partnerHcp}
            powerplayHoleNumbers={powerplayHoleNumbers}
            sideCompHoleNumbers={new Set(sideComps.filter(c => c.enabled).map(c => c.hole_number))}
            expanded={partnerScorecardExpanded}
            onToggle={() => {
              const willExpand = !partnerScorecardExpanded
              setPartnerScorecardExpanded(willExpand)
              if (willExpand) {
                requestAnimationFrame(() => {
                  window.scrollBy({ top: -140, behavior: 'smooth' })
                })
              }
            }}
          />
        )}

        {/* ── Card 2: YOUR MARKER (the partner I mark) ──────────────────── */}
        {requiresMarker && markedScorecard && partnerName && (
          <ScoreCard
            title={isSharedDeviceScoring ? 'SCORING FOR' : 'YOUR PLAYING PARTNER'} name={partnerName} hcp={partnerHcp} par={par} si={si} strokes={partnerStrokes} holeNum={holeNum} distance={distance}
            badge={isSharedDeviceScoring ? '✏️ Paper Player' : null}
            gross={draftPartnerGross} pickedUp={draftPartnerPickedUp} pts={partnerPts} runningTotal={partnerRunningTotal}
            onPick={d => pick('partner', d)} onPar={() => pickPar('partner')} onTogglePickUp={() => togglePickUp('partner')}
            status={partnerComparison} onOpenSummary={() => setShowReconciliation(true)} isLockedForSide={isPartnerLocked}
            activeSideComps={activeSideComps} isPowerplayHole={isPowerplayHole} basePts={partnerBasePts}
          />
        )}
        {/* Field-Test Fix Package, item 3 — a partner IS assigned
            (partnerName is known, from round_markers/profiles) but
            their own scorecard data isn't available yet
            (markedScorecard null) — previously this silently rendered
            nothing at all, leaving a blank gap below "My Score" with
            no explanation. This is a different, more specific
            situation than "no partner at all" (which correctly still
            renders neither block — nothing to explain there). Exact
            copy from the brief. */}
        {requiresMarker && !markedScorecard && partnerName && (
          <div style={{
            marginTop: 12, background: '#faf9f6', border: '1.5px dashed #d9c9a3', borderRadius: 14,
            padding: '20px 16px', textAlign: 'center',
          }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800, color: '#7a7260', marginBottom: 6 }}>
              ⏳ Waiting for {partnerName}
            </div>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af', lineHeight: 1.6, margin: 0 }}>
              Your playing partner hasn&apos;t started scoring yet.<br />
              You can begin entering your score while you wait.
            </p>
          </div>
        )}
        </div>

        {/* Pro Tip — collapsed by default, text only (no audio yet, per
            explicit instruction — structured so 🔊 Listen can be added
            later without redesigning this). "No tip should produce no
            empty/ugly placeholder" — this whole block renders nothing
            at all when hole?.pro_tip is falsy, not a disabled/empty
            state. Placed here deliberately: below both scoring panels,
            above reconciliation/leaderboard — not at the top, where the
            hole header/horizontal scorecard area is already crowded. */}
        {hole?.pro_tip && (
          <div style={{ background: '#fdf3d9', border: '1px solid #e8c96a', borderRadius: 12, marginBottom: 10, overflow: 'hidden' }}>
            <button
              onClick={() => setProTipExpanded(v => !v)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer',
              }}
            >
              <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, color: '#a1791f' }}>🏌️ Pro Tip</span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#a1791f' }}>{proTipExpanded ? '▴' : '▾'}</span>
            </button>
            {proTipExpanded && (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#5c4a1f', padding: '0 14px 12px', margin: 0, lineHeight: 1.5 }}>
                {hole.pro_tip}
              </p>
            )}
          </div>
        )}

        {/* Inline reconciliation panel — appears only when a genuine
            mismatch exists on either side, using the exact same
            myComparison/partnerComparison values already driving each
            card's small 'Needs review' label (that label stays, per the
            explicit instruction, now as a secondary indicator). Renders
            nothing when both sides match — this section adds zero DOM,
            not just zero visible content, when there's nothing to
            resolve. */}
        {(() => {
          const blocks: React.ReactNode[] = []

          if (myComparison === 'mismatch') {
            const mine = myDraftCapture
            const theirs = myMarker[holeNum] ?? null
            blocks.push(
              <MismatchBlock
                key="mine"
                aLabel="You" aCapture={mine} aHandicap={myHcp}
                bLabel={partnerName ?? 'Your Playing Partner'} bCapture={theirs} bHandicap={partnerHcp}
                par={par} strokeIndex={si} isPowerplayHole={isPowerplayHole}
              />
            )
          }
          if (partnerComparison === 'mismatch') {
            const theirs = partnerSelf[holeNum] ?? null
            const mine = partnerDraftCapture
            blocks.push(
              <MismatchBlock
                key="partner"
                aLabel={partnerName ?? 'Your Playing Partner'} aCapture={theirs} aHandicap={partnerHcp}
                bLabel="You" bCapture={mine} bHandicap={myHcp}
                par={par} strokeIndex={si} isPowerplayHole={isPowerplayHole}
              />
            )
          }
          // Score-screen override propagation fix — status precedence:
          // organiser adjudication supersedes the red mismatch
          // presentation entirely (myComparison/partnerComparison
          // already resolve to 'resolved_by_organiser' rather than
          // 'mismatch' the moment admin_overridden is set — see
          // compareCaptures — so these two blocks above and the ones
          // below are already mutually exclusive by construction, not
          // by an extra check here). Previously the only visible sign
          // of an override was a small tappable label in the card
          // header; this adds the same prominent, always-visible
          // explanation panel the red mismatch gets, just in amber,
          // matching the explicit acceptance criteria.
          if (myComparison === 'resolved_by_organiser') {
            const detail = (liveData.myOverrideAudit ?? []).find(a => a.holeId === hole?.id)
            if (detail) blocks.push(<OrganiserOverrideBlock key="mine-override" detail={detail} markerGrossAtHole={myMarker[holeNum]?.grossScore ?? null} />)
          }
          if (partnerComparison === 'resolved_by_organiser') {
            const detail = (liveData.markedOverrideAudit ?? []).find(a => a.holeId === hole?.id)
            if (detail) blocks.push(<OrganiserOverrideBlock key="partner-override" detail={detail} markerGrossAtHole={draftPartnerGross} />)
          }

          if (blocks.length === 0) return null
          return <div style={{ marginTop: 12 }}>{blocks}</div>
        })()}

        {/* Live Leaderboard — a toggled overlay, not a navigation. Full-
            width, visually secondary to score entry (outlined, not
            filled green like Confirm Score), placed exactly where
            specified: below Playing Partner, above the organiser link, with
            enough margin that it isn't confused with that link. */}
        <button
          onClick={() => setShowLeaderboard(true)}
          style={{
            display: 'block', width: '100%', marginTop: 14, padding: '11px 16px',
            background: '#fdf8ee', border: '1.5px solid #d9c9a3', borderRadius: 10,
            fontFamily: 'var(--font-body)', fontSize: 13.5, fontWeight: 700, color: '#7a5c00',
            cursor: 'pointer', textAlign: 'center',
          }}
        >
          🏆 Live Leaderboard
        </button>

        {/* Live Leaderboard overlay — covers the screen while open, but
          this component never unmounts underneath it, so returning via
          "Back to Hole N" lands exactly back where the player left off:
          same hole, same draft scores, same sync state. Reuses the
          existing LiveLeaderboard component and its own data-fetching —
          no second leaderboard implementation. */}
      {showLeaderboard && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 250, background: '#faf9f6', overflowY: 'auto' }}>
          <div style={{
            paddingTop: 'env(safe-area-inset-top, 0px)',
            background: 'linear-gradient(135deg, #0f2d1c, #1a4731)',
            borderBottom: '2px solid #c9a84c',
          }}>
            <div style={{ padding: '14px 16px', fontFamily: 'var(--font-display)', color: '#f5e6b8', fontSize: 15, fontWeight: 700 }}>
              🏆 Live Leaderboard
            </div>
          </div>
          <div style={{ padding: '16px 16px 8px' }}>
            <LiveLeaderboard tripId={tripId} roundId={round.id} roundStatus={round.status} />
          </div>
          {/* "Back to Hole N" moved to the bottom, centred, with its own
              bottom safe-area spacing — the old top placement could sit
              under the iOS status bar / Dynamic Island on notch devices.
              No hard-coded iPhone offset: env(safe-area-inset-bottom)
              resolves to 0 on Android/desktop, so this works unchanged
              everywhere. Still the same setShowLeaderboard(false) that
              was here before, so scoring state (hole, draft scores, sync
              queue) is preserved exactly as it was — nothing about the
              underlying shell remounts. */}
          <div style={{
            textAlign: 'center',
            padding: '8px 16px calc(20px + env(safe-area-inset-bottom, 0px))',
          }}>
            <button
              onClick={() => setShowLeaderboard(false)}
              style={{
                background: '#ffffff', border: '1.5px solid #d9c9a3', borderRadius: 10,
                color: '#7a5c00', fontFamily: 'var(--font-body)', fontSize: 13.5, fontWeight: 700,
                cursor: 'pointer', padding: '11px 24px',
              }}
            >
              ← Back to Hole {holeNum}
            </button>
          </div>
        </div>
      )}

      {/* Fixed scoring action tray. Now that TripBottomNav is hidden
          during active scoring (scoring focus mode), this sits directly
          above the device safe area rather than needing to clear a
          bottom nav that isn't there — the reclaimed space goes to the
          scrollable content's reduced bottom padding above, not to more
          whitespace. Its own position still doesn't depend on any
          calculated total viewport height, which is what makes it
          reliable regardless of address bar state. */}
      {/* P0 fix — spacer sized to this tray's own measured height
          (actionTrayHeight, from the ResizeObserver above), rendered as
          the actual last thing in the scrollable content, immediately
          before the tray itself. This is what lets the page always be
          scrolled fully clear of the tray — Live Leaderboard and
          anything below it — regardless of which horizontal
          scorecard(s) are expanded or what state the tray itself is in. */}
      <div style={{ height: actionTrayHeight }} aria-hidden="true" />
      <div
        ref={actionTrayRef}
        style={{
        position: 'fixed', left: 0, right: 0,
        bottom: 'env(safe-area-inset-bottom, 0px)',
        padding: '8px 16px', background: '#faf9f6',
        borderTop: '1px solid #eceae3', zIndex: 20,
      }}>
        {displaySyncLabel && (
          <div style={{ textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 10.5, color: '#9ca3af', marginBottom: 4 }}>
            {displaySyncLabel}
          </div>
        )}
        <button
          onClick={confirmScore}
          disabled={!canConfirm || flash}
          style={{
            width: '100%', padding: 13,
            background: flash ? '#16a34a' : canConfirm ? 'linear-gradient(135deg,#2d7a52,#16a34a)' : '#e5e7eb',
            color: canConfirm || flash ? '#fff' : '#9ca3af', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-body)',
            cursor: canConfirm ? 'pointer' : 'not-allowed',
          }}
        >
          {flash ? '✓ Saved!' : isLocked ? 'Scores Finalised' : '✓ Confirm Score'}
        </button>

        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <button
            onClick={() => setHoleIdx(i => startInfo?.startType === 'shotgun' ? (i - 1 + holes.length) % holes.length : Math.max(0, i - 1))}
            disabled={startInfo?.startType !== 'shotgun' && holeIdx === 0}
            style={{
              flex: 1, padding: 9, borderRadius: 9,
              background: (startInfo?.startType !== 'shotgun' && holeIdx === 0) ? '#f3f4f6' : '#ffffff',
              border: '1.5px solid #d1d5db',
              color: (startInfo?.startType !== 'shotgun' && holeIdx === 0) ? '#c3c8ce' : '#14532d',
              fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12,
              cursor: (startInfo?.startType !== 'shotgun' && holeIdx === 0) ? 'default' : 'pointer',
            }}
          >
            ← Previous Hole
          </button>
          {/* Shotgun Start — "reached the array's last hole" no longer
              means anything for a circular sequence, so Next Hole
              always just advances (wrapping) rather than sometimes
              becoming this button. Round Summary gets its own always-
              available link below instead — reachable the moment
              allDone is genuinely true (every hole scored, any order),
              not tied to array position. */}
          {startInfo?.startType === 'shotgun' || holeIdx < holes.length - 1 ? (
            <button
              onClick={() => setHoleIdx(i => startInfo?.startType === 'shotgun' ? (i + 1) % holes.length : Math.min(holes.length - 1, i + 1))}
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
        {startInfo?.startType === 'shotgun' && (
          <button
            onClick={() => setShowReconciliation(true)}
            style={{ width: '100%', marginTop: 6, padding: 8, borderRadius: 9, background: 'none', border: '1px solid #d9c9a3', color: '#a1791f', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 11.5, cursor: 'pointer' }}
          >
            Round Summary →
          </button>
        )}
      </div>
    </div>
  )
}

// ── Score card sub-component ───────────────────────────────────────────────────

/**
 * Inline reconciliation panel for a single mismatch — reused for both
 * "my hole" and "the partner's hole" cases (a self_and_marker round
 * shows both simultaneously, and either can be mismatched independently).
 * Points for each side are computed with the exact same
 * calculateStableford() used everywhere else in the app (imported at the
 * top of this file already) — no second Stableford implementation.
 * isZeroPointsMismatch() (already built and tested for the Friday
 * field-test case) decides which of the two required treatments applies.
 */
function MismatchBlock({
  aLabel, aCapture, aHandicap, bLabel, bCapture, bHandicap, par, strokeIndex, isPowerplayHole,
}: {
  aLabel: string; aCapture: CaptureValue | null; aHandicap: number
  bLabel: string; bCapture: CaptureValue | null; bHandicap: number
  par: number; strokeIndex: number; isPowerplayHole?: boolean
}) {
  const pointsFor = (capture: CaptureValue | null, handicap: number): number | null => {
    if (!capture) return null
    if (capture.pickedUp) return 0
    if (capture.grossScore === null) return null
    try {
      return calculateStableford({ grossScore: capture.grossScore, par, strokeIndex, playingHandicap: handicap, isPowerplayHole })
    } catch {
      return null
    }
  }
  const aPts = pointsFor(aCapture, aHandicap)
  const bPts = pointsFor(bCapture, bHandicap)

  const isZeroBoth = isZeroPointsMismatch(aCapture, bCapture, {
    par, strokeIndex, selfHandicap: aHandicap, markerHandicap: bHandicap,
  })

  const describe = (capture: CaptureValue | null) =>
    capture?.pickedUp ? 'Pick up' : capture?.grossScore != null ? `${capture.grossScore} strokes` : '—'

  const palette = isZeroBoth
    ? { bg: '#fdf3d9', border: '#e8c96a', heading: '#a1791f' }
    : { bg: '#fef2f2', border: '#fecaca', heading: '#dc2626' }

  return (
    <div style={{ background: palette.bg, border: `1.5px solid ${palette.border}`, borderRadius: 12, padding: '12px 14px', marginBottom: 8 }}>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 800, color: palette.heading, letterSpacing: 0.3, marginBottom: 8 }}>
        {isZeroBoth ? '⚠ SCORES RECORDED DIFFERENTLY' : "⚠ SCORES DON'T MATCH"}
      </div>

      <div style={{ display: 'flex', gap: 20, marginBottom: 8 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, color: '#14532d' }}>{aLabel}:</div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#374151' }}>
            {describe(aCapture)}{aPts !== null ? ` · ${aPts} pt${aPts === 1 ? '' : 's'}` : ''}
          </div>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, color: '#14532d' }}>{bLabel}:</div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#374151' }}>
            {describe(bCapture)}{bPts !== null ? ` · ${bPts} pt${bPts === 1 ? '' : 's'}` : ''}
          </div>
        </div>
      </div>

      <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: palette.heading, lineHeight: 1.4 }}>
        {isZeroBoth
          ? 'Both entries result in 0 Stableford points. Please confirm which score should be recorded.'
          : 'Please check the scores above and make them match before confirming this hole.'}
      </div>
    </div>
  )
}

/**
 * Score-screen override propagation fix — the amber counterpart to
 * MismatchBlock. Rendered instead of (never alongside) the red block
 * for the same hole, since myComparison/partnerComparison already
 * resolve to exactly one of 'mismatch' or 'resolved_by_organiser', not
 * both — status precedence (organiser adjudication supersedes an
 * unresolved mismatch) is enforced at the comparison-status level
 * (compareCaptures), not by a second check duplicated here.
 *
 * "Original player score"/"Original marker score" are deliberately
 * exactly that — the audit row's own oldGrossScore and the other
 * side's live gross value — never rewritten to match the official
 * score. This panel explains the old values; it doesn't relabel them.
 */
function OrganiserOverrideBlock({ detail, markerGrossAtHole }: { detail: OverrideAuditEntry; markerGrossAtHole: number | null }) {
  return (
    <div style={{ background: '#fdf3d9', border: '1.5px solid #e8c96a', borderRadius: 12, padding: '12px 14px', marginBottom: 8 }}>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 800, color: '#a1791f', letterSpacing: 0.3, marginBottom: 4 }}>
        ⚙️ Organiser Override
      </div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, color: '#166534', marginBottom: 8 }}>
        Resolved by organiser
      </div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#374151', marginBottom: 2 }}>
        Original player score: <strong>{detail.oldGrossScore ?? '—'}</strong>
      </div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#374151', marginBottom: 2 }}>
        Original marker score: <strong>{markerGrossAtHole ?? '—'}</strong>
      </div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#374151', marginBottom: 8 }}>
        Official score: <strong style={{ color: '#166534' }}>{detail.newGrossScore}</strong>
      </div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#a1791f' }}>Reason: {detail.reason}</div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#a1791f' }}>Organiser: {detail.overriddenByName}</div>
    </div>
  )
}

function ScoreCard({
  title, name, hcp, par, si, strokes, holeNum, distance, gross, pickedUp, pts, runningTotal, onPick, onPar, onTogglePickUp, status, onOpenSummary, isLockedForSide, activeSideComps, isPowerplayHole, basePts, badge,
}: {
  title: string; name: string; hcp: number; par: number; si: number; strokes: number; holeNum: number
  distance?: number | null
  gross: number | null; pickedUp: boolean; pts: number | null; runningTotal: number
  onPick: (delta: number) => void; onPar: () => void; onTogglePickUp: () => void
  status: ComparisonStatus | null; onOpenSummary?: () => void; isLockedForSide?: boolean
  activeSideComps?: { id: string; comp_type: string }[]; isPowerplayHole?: boolean; basePts?: number | null
  // Add-on 1 (corrected architecture) — "SCORING FOR / Marnie ✏️ Paper
  // Player." Optional, purely cosmetic addition next to the name — no
  // other card behaviour reads or depends on this.
  badge?: string | null
}) {
  return (
    <div style={{ borderRadius: 12, background: '#ffffff', border: '1px solid #d9d4c7', boxShadow: '0 3px 14px rgba(0,0,0,0.08)', marginBottom: 6, overflow: 'hidden' }}>
      <div className="scoring-card-header" style={{ background: '#f7f6f1', padding: '5px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #d9d4c7' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 8.5, fontWeight: 700, color: '#a1791f', letterSpacing: 0.7 }}>{title}</div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 16, fontWeight: 800, color: '#14532d', lineHeight: 1.1 }}>
            {name}
            {badge && (
              <span style={{ fontSize: 10.5, fontWeight: 700, color: '#a1791f', marginLeft: 6 }}>{badge}</span>
            )}
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 9.5, fontWeight: 500, color: '#6b6558' }}>
            Playing Handicap {hcp}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: '#a1791f', lineHeight: 1 }}>
            H{holeNum}
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 600, color: '#8a6d3f', marginTop: 1 }}>
            {distance != null ? `${distance}m · ` : ''}Par {par} · SI {si}
          </div>
          {(activeSideComps && activeSideComps.length > 0) || isPowerplayHole
            ? <HoleBadges activeSideComps={activeSideComps ?? []} isPowerplayHole={!!isPowerplayHole} />
            : null}
          {status && (status === 'matched' || status === 'mismatch' || status === 'resolved_by_organiser') && (
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 9.5, fontWeight: 700, color: statusColor(status), marginTop: 2 }}>
              {status === 'resolved_by_organiser' ? '⚙️ Organiser Override' : COMPARISON_LABEL[status]}
            </div>
          )}
        </div>
      </div>

      <div className="scoring-card-body" style={{ padding: '9px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <button onClick={() => onPick(-1)} disabled={isLockedForSide} style={{ width: 50, height: 50, borderRadius: 12, background: isLockedForSide ? '#f3f4f6' : '#f7f6f1', border: '1.5px solid #c9c2b2', color: isLockedForSide ? '#9a9a9a' : '#14532d', fontSize: 22, flexShrink: 0, cursor: isLockedForSide ? 'default' : 'pointer' }}>−</button>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-display)', color: pickedUp ? '#c9a84c' : gross === null ? '#9a9284' : '#14532d', fontSize: 50, fontWeight: 800, lineHeight: 1 }}>
              {pickedUp ? 'P' : gross ?? '0'}
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#52525b', marginTop: 5 }}>
              {pickedUp ? '0 Points (pick-up)' : pts !== null ? `${pts} Point${pts === 1 ? '' : 's'}` : 'Par ' + par + ' · SI ' + si}
            </div>
            {/* Sprint 9 — Powerplay visual treatment. Shows the
                transformation explicitly (brief's own "3 × 2 = 6 pts"
                example) rather than just a bigger/different-colored
                number, so it's unambiguous this is a rule applying, not
                an unusually good hole. pts itself (above) already IS the
                doubled value — this line is purely explanatory, doesn't
                drive any calculation. */}
            {isPowerplayHole && !pickedUp && basePts !== null && basePts !== undefined && pts !== null && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4,
                background: '#fdf3d9', border: '1px solid #e8c96a', borderRadius: 8, padding: '2px 8px',
              }}>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#a1791f' }}>
                  ⚡ {basePts} × 2 = {pts} pts
                </span>
              </div>
            )}
          </div>
          <button onClick={() => onPick(1)} disabled={isLockedForSide} style={{ width: 50, height: 50, borderRadius: 12, background: isLockedForSide ? '#f3f4f6' : '#f7f6f1', border: '1.5px solid #c9c2b2', color: isLockedForSide ? '#9a9a9a' : '#14532d', fontSize: 22, flexShrink: 0, cursor: isLockedForSide ? 'default' : 'pointer' }}>+</button>
        </div>

        {/* Pick Up — relocated here from the permanent tile row below, per
            Darren's feedback. Same onTogglePickUp behavior, just moved: it's
            an action, not a status, so it reads better as a small secondary
            control near the score selector than as one-third of the
            PAR/SHOTS/TOTAL summary row. */}
        <div style={{ textAlign: 'center', marginTop: 6 }}>
          <button
            onClick={onTogglePickUp}
            disabled={isLockedForSide}
            style={{
              fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700,
              color: pickedUp ? '#a1791f' : '#52525b',
              background: pickedUp ? '#fdf3d9' : '#f7f6f1',
              border: pickedUp ? '1px solid #e8c96a' : '1px solid #b8b2a3',
              borderRadius: 18, padding: '3px 12px', cursor: 'pointer',
            }}
          >
            {pickedUp ? '✕ Picked up — tap to undo' : 'Pick up'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
          <button onClick={onPar} disabled={isLockedForSide} style={{ flex: 1, padding: '5px 4px', borderRadius: 8, background: gross === par && !pickedUp ? '#dcfce7' : '#eefbf2', border: gross === par && !pickedUp ? '1px solid #86efac' : '1px solid #b8ddc3', textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 8.5, color: gross === par && !pickedUp ? '#16a34a' : '#3f7a52' }}>PAR</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 800, color: '#16a34a' }}>{par}</div>
          </button>
          <div style={{ flex: 1, textAlign: 'center', padding: '5px 4px', borderRadius: 8, background: '#f7f6f1', border: '1px solid #c9c2b2' }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 8.5, color: '#6b6558' }}>SHOTS</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: '#14532d', fontWeight: 700 }}>{strokes}</div>
          </div>
          <button
            onClick={onOpenSummary}
            disabled={!onOpenSummary}
            style={{ flex: 1, textAlign: 'center', padding: '5px 4px', borderRadius: 8, background: '#fdf3d9', border: '1px solid #e8c96a', cursor: onOpenSummary ? 'pointer' : 'default' }}
          >
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 8.5, color: '#a1791f' }}>TOTAL</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 800, color: '#a1791f' }}>{runningTotal}</div>
          </button>
        </div>
      </div>
    </div>
  )
}
