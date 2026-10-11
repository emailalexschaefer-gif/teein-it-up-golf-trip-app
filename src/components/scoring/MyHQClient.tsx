'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import RoundSchedule, { type ScheduleRound } from './RoundSchedule'
import TournamentControl, { EventStorySection, EventHealthSection, type StoryEntry, type EventHealthInfo } from './TournamentControl'
import RoundHighlightsCard from './RoundHighlightsCard'
import RoundHighlightsSection from './RoundHighlightsSection'
import EventMemoriesCard from './EventMemoriesCard'
import AdminScoreOverridePanel from './AdminScoreOverridePanel'
import MyRoundSummary from './MyRoundSummary'
import RoundWorkflowTracker from './RoundWorkflowTracker'
import EventProgressBadge from './EventProgressBadge'
import CollapsibleSection from '@/components/shared/CollapsibleSection'
import { trackEvent } from '@/lib/analytics/trackEvent'
import { deriveRoundWorkflow, deriveEventProgress, deriveStartRoundReadiness, type WorkflowStageId } from '@/lib/scoring/roundWorkflow'
import { resolvePlayingHandicap } from '@/lib/scoring/defaultHoles'

/**
 * My HQ V2 (10 Oct), Phase C — the two small, read-only queries behind
 * the Guided Workflow tracker and Event Progress badge below. These
 * deliberately use the EXACT SAME query keys TournamentControl and
 * MakersBreakers/RoundHighlightsSection already use for the same
 * endpoints (['tournament', tripId, roundId] and
 * ['published-highlights', tripId, roundId]) — React Query shares one
 * cache entry per key across every component mounted under the same
 * provider, so this never doubles the real network traffic once
 * either side has fetched; it only ever reads the same authoritative
 * data TournamentControl itself reads, never a second calculation of
 * round status, completion, or review state.
 */
interface WorkflowTournamentSummary {
  summary: { finishedCount: number; players: number; completionPct: number; awaitingReconciliation: number }
  // Phase E (11 Oct), Task #55 — `story` is already present in the
  // real JSON response (TournamentControl.tsx's own TournamentData
  // reads it directly from the same endpoint); declaring it here too
  // doesn't add a fetch, it just lets this already-shared React Query
  // cache entry feed Stage 5's embedded EventStorySection as well.
  story: StoryEntry[]
  // Phase E (11 Oct) verification pass — same reasoning: `health` and
  // `mismatchAlerts` are already in the real JSON response; declaring
  // them here lets EventHealthSection render genuinely outside the
  // five stages, reading this same shared cache entry, no new fetch.
  health: EventHealthInfo
  mismatchAlerts: unknown[]
}
interface PublishedHighlightsSummary { publishedAt: string | null; highlights: unknown[] }

/**
 * Phase D (10 Oct) Task #39 -- Stage 1 readiness. Reuses the EXISTING
 * `/setup-context` endpoint verbatim (confirmed by reading its route
 * handler directly -- it's the Begin Round wizard's own data source
 * for groups/players/handicaps, not a new or speculative query) and
 * the EXISTING `resolvePlayingHandicap()` helper the wizard itself
 * uses for the identical per-player check. This only shapes that same
 * data into deriveStartRoundReadiness()'s three plain inputs -- it
 * doesn't duplicate the wizard's own submit-time server validation
 * (start/route.ts), it's a read-only preview using the same criteria.
 */
interface SetupContextGroup {
  id: string
  players: { full_name: string; playing_handicap: number | null; profile_handicap: number | null }[]
}
interface SetupContextSummary { groups: SetupContextGroup[] }

/**
 * P0 field-test fix — "My HQ — completed-round information disappears."
 *
 * Root cause: the previous page.tsx only ever rendered TournamentControl
 * when `activeRound` existed, hardcoded to that one round's id. The
 * moment Round 1 completed and Round 2 was still 'upcoming' (not yet
 * 'active'), `activeRound` became undefined and the ENTIRE detailed
 * dashboard — leaderboard, Side Games, group progress, completion
 * status, stats, Makers & Breakers, Moments, Event Story, alerts — was
 * replaced by a small "Round 1 Complete / Round 2 ready" CTA card, with
 * no way back to Round 1's own data. RoundSchedule was also rendered
 * with interactive={false}, because page.tsx is a Server Component and
 * can't pass a real onSelect handler across that boundary — so the
 * Event Schedule cards weren't clickable either.
 *
 * Fix follows the exact same pattern already proven correct for the
 * player-facing equivalent (MyRoundClient.tsx + PlayerRoundView, which
 * has never had this bug): a client component holding selectedRoundId
 * state, an interactive RoundSchedule with a real onSelect, and
 * TournamentControl rendered for whichever round is SELECTED — not
 * whichever round happens to be 'active' server-side. TournamentControl
 * itself already handles roundStatus === 'completed' correctly (see its
 * own line ~448 gating the Close Round button and polling on status),
 * so no changes were needed there; it was simply never given the choice
 * of which round to show before now.
 *
 * The "Round 1 Complete / Round 2 ready" and "Event Complete" CTA cards
 * are preserved — they're genuinely useful "what's next" narration —
 * but now render ADDITIONALLY, not INSTEAD OF, the selected round's
 * full dashboard. Completed rounds remain permanently explorable via
 * the selector, exactly as required.
 */
export default function MyHQClient({
  tripId, rounds, defaultRoundId, organiserIsPlaying,
  mostRecentlyCompletedRoundId, mostRecentlyCompletedRoundName,
  nextUpcomingRoundId, nextUpcomingRoundName, eventFullyComplete,
}: {
  tripId: string
  rounds: ScheduleRound[]
  defaultRoundId: string | null
  organiserIsPlaying: boolean
  mostRecentlyCompletedRoundId: string | null
  mostRecentlyCompletedRoundName: string | null
  nextUpcomingRoundId: string | null
  nextUpcomingRoundName: string | null
  eventFullyComplete: boolean
}) {
  const router = useRouter()
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(defaultRoundId)
  const selected = rounds.find(r => r.id === selectedRoundId) ?? null

  // Shares its cache with TournamentControl's own identically-keyed
  // query (see this file's top-of-file note) — not a second fetch of
  // live data once either side is warm.
  const { data: workflowTournamentData } = useQuery<WorkflowTournamentSummary>({
    queryKey: ['tournament', tripId, selected?.id],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/rounds/${selected!.id}/tournament`)
      if (!res.ok) throw new Error('Could not load tournament data.')
      return res.json()
    },
    enabled: !!selected,
    refetchInterval: selected?.status === 'active' ? 8000 : false,
    staleTime: 0,
  })
  const { data: publishedHighlightsData } = useQuery<PublishedHighlightsSummary>({
    queryKey: ['published-highlights', tripId, selected?.id],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/rounds/${selected!.id}/published-highlights`)
      if (!res.ok) throw new Error('Could not load highlights.')
      return res.json()
    },
    enabled: !!selected && selected.status === 'completed',
    staleTime: 60000,
  })

  // Only fetched while the round is still 'upcoming' -- once it's
  // started this preview is moot (Stage 1 is already complete), so
  // there's no reason to keep polling groups/handicaps for an active
  // or completed round.
  const { data: setupContextData, isLoading: setupContextLoading, isError: setupContextError } = useQuery<SetupContextSummary>({
    queryKey: ['setup-context', tripId, selected?.id],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/rounds/${selected!.id}/setup-context`)
      if (!res.ok) throw new Error('Could not load setup context.')
      return res.json()
    },
    enabled: !!selected && selected.status === 'upcoming',
    staleTime: 30000,
  })

  const startReadiness = setupContextData ? deriveStartRoundReadiness({
    groupCount: setupContextData.groups.length,
    assignedPlayerCount: setupContextData.groups.reduce((sum, g) => sum + g.players.length, 0),
    playersMissingHandicap: setupContextData.groups
      .flatMap(g => g.players)
      .filter(p => resolvePlayingHandicap(p.playing_handicap, p.profile_handicap) === null)
      .map(p => p.full_name),
  }) : null

  // Final pre-production gate (10 Oct), item 3 -- a loading or failed
  // setup-context fetch must never be indistinguishable from a
  // confirmed-ready round. Both react-query's `isLoading`/`isError`
  // are gated the same way the query itself is `enabled` (upcoming
  // round only) -- once the round has started, or on a round that
  // never needed this query at all, these are simply false, same as
  // before this fix. deriveRoundWorkflow only ever reads these to
  // pick Stage 1's wording; the actual Start Round action (handled
  // below in handleWorkflowAction) still just navigates to the Rounds
  // tab regardless -- the Begin Round wizard remains the one and only
  // authoritative validator, this preview never gates anything.
  const startReadinessLoading = !!selected && selected.status === 'upcoming' && setupContextLoading
  const startReadinessError = !!selected && selected.status === 'upcoming' && setupContextError

  // The existing Close Round button's own readiness condition
  // (TournamentControl.tsx), reused verbatim here too — never
  // recalculated, just read from the same already-fetched summary.
  const readyToClose = selected?.status === 'active'
    && workflowTournamentData?.summary.completionPct === 100
    && workflowTournamentData?.summary.awaitingReconciliation === 0

  // ScheduleRound's `status` is a plain `string` (matching
  // TournamentControl's own existing `roundStatus: string` prop) since
  // it's threaded through from a Server Component boundary; narrowed
  // here to the three real values, same as every other status check
  // already scattered across this codebase (e.g. `roundStatus ===
  // 'active'`), not a new assumption.
  function asRoundStatus(status: string): 'upcoming' | 'active' | 'completed' {
    return status === 'active' || status === 'completed' ? status : 'upcoming'
  }

  const workflow = selected ? deriveRoundWorkflow({
    roundStatus: asRoundStatus(selected.status),
    finishedPlayers: workflowTournamentData?.summary.finishedCount ?? 0,
    totalPlayers: workflowTournamentData?.summary.players ?? 0,
    completionPct: workflowTournamentData?.summary.completionPct ?? 0,
    awaitingReconciliation: workflowTournamentData?.summary.awaitingReconciliation ?? 0,
    readyToClose: !!readyToClose,
    highlightsPublishedAt: publishedHighlightsData?.publishedAt ?? null,
    highlightsSelectedCount: publishedHighlightsData?.highlights.length ?? 0,
    startReadiness,
    startReadinessLoading,
    startReadinessError,
  }) : null

  const eventProgress = deriveEventProgress({ rounds: rounds.map(r => ({ status: asRoundStatus(r.status) })) })

  // Phase E (11 Oct), Task #55 — which Round Control Centre stage rows
  // are expanded, now CONTROLLED here (not owned inside
  // RoundWorkflowTracker) so handleWorkflowAction below can expand a
  // stage as part of its existing action (e.g. "Close Round" needs
  // Stage 2's embedded dashboard open before it can scroll to the
  // Close Round control living inside it) and so switching rounds can
  // re-seed which stage opens by default, exactly once per round
  // selection — never on a background data refresh/poll, per the
  // approved brief's explicit "manual expansion choices should not be
  // repeatedly overridden by data refreshes" requirement.
  const [expandedStages, setExpandedStages] = useState<Set<WorkflowStageId>>(new Set())
  const autoOpenedForRound = useRef<string | null>(null)
  useEffect(() => {
    if (selected && workflow?.primaryStageId && autoOpenedForRound.current !== selected.id) {
      setExpandedStages(new Set([workflow.primaryStageId]))
      autoOpenedForRound.current = selected.id
    }
  }, [selected?.id, workflow?.primaryStageId])

  function toggleStage(stageId: WorkflowStageId) {
    setExpandedStages(prev => {
      const next = new Set(prev)
      if (next.has(stageId)) next.delete(stageId); else next.add(stageId)
      return next
    })
  }

  // Each action just routes the organiser to the existing control that
  // already performs it — this never invents a parallel start/close/
  // review flow. Start Round and Review & Present route to the
  // existing pages that already handle them, unchanged. Close Round's
  // own control and the Makers & Breakers tools now live INSIDE this
  // tracker's own Stage 2/3 and Stage 4 bodies (Task #55 — see
  // renderStageBody below), so their actions now expand the relevant
  // stage(s) rather than scrolling to a now-removed external anchor;
  // Close Round's embedded control lives inside Stage 2's body, so
  // that stage is expanded too before scrolling to it.
  function handleWorkflowAction(stageId: WorkflowStageId) {
    if (stageId === 'start') { router.push(`/trips/${tripId}?tab=rounds`); return }
    if (stageId === 'close') {
      setExpandedStages(prev => new Set([...prev, 'manage', 'close']))
      setTimeout(() => document.getElementById('close-round-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
      return
    }
    if (stageId === 'makersBreakers') {
      setExpandedStages(prev => new Set([...prev, 'makersBreakers']))
      return
    }
    if (stageId === 'reviewPresent') {
      // Phase D (10 Oct) — per the original approved Stage 5 spec
      // ("Create Round Presentation" for an individual round vs.
      // "Create Event Presentation" once the whole event is
      // complete), and per the Phase A audit's own proposed
      // ?startSlideshow= convention, now actually wired up on the
      // Memories page (see that page's deep-link effect). This never
      // removes the plain picker — a round whose id the deep link
      // can't match just falls through to it unchanged.
      if (eventProgress.allRoundsClosed) { router.push(`/trips/${tripId}/memories?startSlideshow=event`); return }
      if (selected) { router.push(`/trips/${tripId}/memories?startSlideshow=round&roundId=${selected.id}`); return }
      router.push(`/trips/${tripId}/memories`)
    }
  }

  // GA4 / Product Analytics brief — organiser behaviour, "how often My
  // HQ is opened." Once per mount only.
  useEffect(() => {
    trackEvent('my_hq_opened', { tripId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Phase E (11 Oct), Task #55 — the Round Control Centre's five stage
  // bodies. Per the approved brief ("reusing and repositioning
  // components is preferred over rebuilding their logic"), every body
  // below mounts an existing, unmodified component or reads data this
  // file already fetches — nothing here recalculates readiness,
  // completion, or review state a second time.
  function renderStageBody(stageId: WorkflowStageId) {
    if (!selected) return null

    if (stageId === 'start') {
      // Read-only preview, reusing the exact same setupContextData/
      // startReadiness this file already computes for Stage 1's own
      // detail text above — the Begin Round wizard (reached via the
      // existing "Start Round" action button) remains the one and
      // only authoritative validator; nothing here gates it.
      if (selected.status !== 'upcoming') {
        return (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af' }}>
            This round has already started — setup is locked in.
          </p>
        )
      }
      if (startReadinessLoading) {
        return <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af' }}>Checking setup…</p>
      }
      if (startReadinessError || !setupContextData) {
        return <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#dc2626' }}>Could not load setup details.</p>
      }
      const playerCount = setupContextData.groups.reduce((sum, g) => sum + g.players.length, 0)
      const missingHandicap = setupContextData.groups
        .flatMap(g => g.players)
        .filter(p => resolvePlayingHandicap(p.playing_handicap, p.profile_handicap) === null)
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <SetupStat label="Groups" value={setupContextData.groups.length} />
            <SetupStat label="Players" value={playerCount} />
            <SetupStat label="Missing handicap" value={missingHandicap.length} warn={missingHandicap.length > 0} />
          </div>
          {missingHandicap.length > 0 && (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#a1791f' }}>
              {missingHandicap.map(p => p.full_name).join(', ')} still need{missingHandicap.length === 1 ? 's' : ''} a handicap before this round starts.
            </p>
          )}
        </div>
      )
    }

    if (stageId === 'manage') {
      // The live operational dashboard — Leaderboard Snapshot, Round
      // Summary, Group Progress, Alerts, Side Games, Playing Partner
      // Status, Live Statistics and Group Map all still live inside
      // this one component, unchanged; only its mounting position
      // moved, from an always-visible page section to this stage's own
      // embedded body. (Event Health moved a second time, after the
      // user's review confirmed it was disappearing whenever every
      // stage was collapsed — it now mounts separately, directly from
      // this file, genuinely outside all five stages; see the
      // standalone health section mounted above, near Event Progress.)
      // The Close Round control (Stage 3) also lives inside
      // TournamentControl — see handleWorkflowAction's
      // 'close' branch, which expands this stage too before scrolling
      // to it, and the note on Stage 3's own body below.
      //
      // Score Management (Task #54's round-follow fix, Task #62's
      // relocation) is mounted directly beneath it, within this same
      // stage body — not a second standalone page section — preserving
      // its own independent manual-override tracking and its
      // My-HQ-round-follow behaviour unchanged, both still driven by
      // `myHqRoundId={selected.id}` exactly as before.
      return (
        <div>
          <TournamentControl tripId={tripId} roundId={selected.id} roundStatus={selected.status} />
          {rounds.some(r => r.status === 'active' || r.status === 'completed') && (
            <div id="score-management" style={{ marginTop: 20 }}>
              <div style={{ height: 1, background: '#eceae3', marginBottom: 16 }} />
              <AdminScoreOverridePanel
                tripId={tripId}
                rounds={rounds.filter(r => r.status === 'active' || r.status === 'completed')}
                myHqRoundId={selected.id}
              />
            </div>
          )}
        </div>
      )
    }

    if (stageId === 'close') {
      // Close Round's real control (the ready-to-close card, the
      // confirm modal, and the post-round snapshot flow) lives inside
      // TournamentControl, embedded in Stage 2 just above — it owns
      // the closing/confirmation state and can't safely be split into
      // a second, independent mount without duplicating that state.
      // This body stays an honest short status line plus a jump
      // straight to the real control, rather than a second copy of it.
      return (
        <div>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260', marginBottom: 8 }}>
            {readyToClose
              ? 'This round is ready to close.'
              : workflowTournamentData
                ? `${workflowTournamentData.summary.completionPct}% complete, ${workflowTournamentData.summary.awaitingReconciliation} awaiting reconciliation.`
                : 'Checking round completion…'}
          </p>
          <button
            onClick={() => handleWorkflowAction('close')}
            style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #d8d4c8', background: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12, color: '#14532d', cursor: 'pointer' }}
          >
            Open Close Round control ↓
          </button>
        </div>
      )
    }

    if (stageId === 'makersBreakers') {
      // Phase E consolidation — the two previously scattered Makers &
      // Breakers entry points (RoundHighlightsCard's selection/review
      // tool, and RoundHighlightsSection's read-only published view,
      // formerly a standalone My HQ card and a section buried inside
      // TournamentControl respectively) now live together, here, in
      // the one stage that's actually about Makers & Breakers. Neither
      // component's own logic changed.
      if (selected.status !== 'completed') {
        return (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af' }}>
            Available once this round is closed.
          </p>
        )
      }
      return (
        <div>
          <RoundHighlightsCard tripId={tripId} roundId={selected.id} roundName={selected.name} />
          <RoundHighlightsSection tripId={tripId} roundId={selected.id} roundName={selected.name} />
        </div>
      )
    }

    if (stageId === 'reviewPresent') {
      // Event Story and Event Memories both moved out of
      // TournamentControl's own tail (where they rendered
      // unconditionally regardless of which stage, if any, was
      // relevant) into the one stage that's genuinely about
      // reviewing/presenting the event. `story` is read from the same
      // shared ['tournament', tripId, roundId] query cache entry
      // TournamentControl itself populates — no second fetch.
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <CollapsibleSection icon="📖" title="Event Story">
            <EventStorySection tripId={tripId} golfStory={workflowTournamentData?.story ?? []} />
          </CollapsibleSection>
          <EventMemoriesCard tripId={tripId} />
        </div>
      )
    }

    return null
  }

  return (
    <div>
      {/* Event Schedule — now the actual round selector, per the exact
          requirement. Same RoundSchedule component My Round already
          uses; only the wiring (interactive + onSelect, both now
          possible from inside a client component) changed. */}
      <RoundSchedule
        rounds={rounds} selectedRoundId={selectedRoundId ?? ''} defaultRoundId={defaultRoundId}
        onSelect={setSelectedRoundId} tripId={tripId}
      />

      {/* My HQ V2 (10 Oct), Phase C — event-level progress (never
          derived from Makers & Breakers/presentation status), then the
          selected round's own five-stage Guided Workflow. Both sit
          directly beneath Event Schedule per the approved page
          hierarchy (Event Schedule → Guided Workflow → Contextual
          Tools → ...). */}
      <EventProgressBadge closedCount={eventProgress.closedCount} totalCount={eventProgress.totalCount} />

      {/* Phase E (11 Oct) verification pass — Event Health, genuinely
          outside all five stages (confirmed by direct inspection: it
          previously rendered inside TournamentControl, which only
          mounts when Stage 2 is expanded — an organiser with every
          stage collapsed could not see it at all). Reads the same
          shared ['tournament', tripId, selected.id] query cache entry
          already used for `summary`/`story` above — no new fetch, no
          second health calculation. */}
      {selected && workflowTournamentData && (
        <div style={{ marginBottom: 16 }}>
          <EventHealthSection
            tripId={tripId} roundId={selected.id}
            health={workflowTournamentData.health}
            mismatchCount={workflowTournamentData.mismatchAlerts.length}
            onViewAffectedPlayers={() => {
              setExpandedStages(prev => new Set([...prev, 'manage']))
              setTimeout(() => document.getElementById('alerts-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
            }}
          />
        </div>
      )}

      {selected && workflow && (
        <div style={{ marginBottom: 16 }}>
          <RoundWorkflowTracker
            roundName={selected.name}
            stages={workflow.stages}
            primaryStageId={workflow.primaryStageId}
            onAction={handleWorkflowAction}
            expandedStages={expandedStages}
            onToggleStage={toggleStage}
            renderBody={renderStageBody}
          />
        </div>
      )}

      {/* "What's next" narration — informational only now, never a
          replacement for the dashboard below. Only shown when the round
          the organiser has SELECTED is the one that just completed
          (matches the previous behaviour's intent — this message is
          about that specific completion, not a permanent fixture every
          time an old completed round is later revisited). */}
      {selected?.id === mostRecentlyCompletedRoundId && nextUpcomingRoundId && nextUpcomingRoundName && (
        <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', padding: '20px', textAlign: 'center', marginBottom: 16 }}>
          <p style={{ fontSize: 26, marginBottom: 8 }}>🏁</p>
          <p style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 15, fontWeight: 800, marginBottom: 6 }}>
            {mostRecentlyCompletedRoundName ?? 'This round'} Complete
          </p>
          <p style={{ fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 12.5, lineHeight: 1.5, marginBottom: 14 }}>
            {nextUpcomingRoundName} is ready when you are.
          </p>
          <Link
            href={`/trips/${tripId}?tab=rounds`}
            style={{
              display: 'inline-block', padding: '9px 18px', borderRadius: 10,
              background: '#14532d', color: '#fff', fontFamily: 'var(--font-body)',
              fontSize: 13, fontWeight: 700, textDecoration: 'none',
            }}
          >
            Go to {nextUpcomingRoundName} →
          </Link>
        </div>
      )}

      {selected?.id === mostRecentlyCompletedRoundId && eventFullyComplete && (
        <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', padding: '20px', textAlign: 'center', marginBottom: 16 }}>
          <p style={{ fontSize: 26, marginBottom: 8 }}>🏆</p>
          <p style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 15, fontWeight: 800, marginBottom: 6 }}>Event Complete</p>
          <p style={{ fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 12.5, lineHeight: 1.5, marginBottom: 14 }}>
            All rounds have been played and results are locked in.
          </p>
          <Link
            href={`/trips/${tripId}/results`}
            style={{
              display: 'inline-block', padding: '9px 18px', borderRadius: 10,
              background: '#14532d', color: '#fff', fontFamily: 'var(--font-body)',
              fontSize: 13, fontWeight: 700, textDecoration: 'none',
            }}
          >
            View Final Results →
          </Link>
        </div>
      )}

      {selected ? (
        <>
          {/* Phase E (11 Oct), Task #55 — TournamentControl (the live
              operational dashboard) and the Makers & Breakers entry
              points both moved out of this always-visible position.
              They now mount inside the Round Control Centre's own
              Stage 2/3 and Stage 4 bodies above (see renderStageBody),
              so what's visible here depends on which stage the
              organiser has expanded, instead of every section
              rendering unconditionally one after another regardless of
              where the round actually is in its lifecycle.
              Task #54's Score Management relocation (previously
              rendered here as a standalone section) has itself now
              moved a second time, into Stage 2's own body alongside
              TournamentControl — see renderStageBody's 'manage' branch
              and AdminScoreOverridePanel's own prop doc comment for how
              following vs. a deliberate manual override is handled. */}

          {organiserIsPlaying && (
            <div style={{ marginTop: 20 }}>
              <div style={{ height: 1, background: '#eceae3', marginBottom: 16 }} />
              {/* My Golf + My HQ UX Cleanup brief (5 Sep), item 9 —
                  "MY ROUND." The organiser-as-player summary — never to
                  be confused with My Golf's player-facing "Recap Round"
                  (a different page entirely, per that file's own note). */}
              <CollapsibleSection icon="⛳" title="My Round">
                <MyRoundSummary tripId={tripId} roundId={selected.id} roundStatus={selected.status} />
              </CollapsibleSection>
            </div>
          )}
        </>
      ) : (
        // No rounds at all yet — the genuine pre-event empty state.
        <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', padding: '32px 20px', textAlign: 'center' }}>
          <p style={{ fontSize: 32, marginBottom: 10 }}>⛳</p>
          <p style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 16, fontWeight: 800, marginBottom: 8 }}>
            Your control centre
          </p>
          <p style={{ fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13, lineHeight: 1.5, marginBottom: 18 }}>
            My HQ comes alive once the round begins — live leaderboard,
            score management and side games will all appear here.
          </p>
          <Link
            href={`/trips/${tripId}?tab=rounds`}
            style={{
              display: 'inline-block', padding: '10px 20px', borderRadius: 10,
              background: '#14532d', color: '#fff', fontFamily: 'var(--font-body)',
              fontSize: 13.5, fontWeight: 700, textDecoration: 'none',
            }}
          >
            Go to Rounds →
          </Link>
        </div>
      )}
    </div>
  )
}

// Phase E (11 Oct), Task #55 — small presentational helper for Stage 1's
// embedded setup summary body. No logic of its own, just a label/value pair.
function SetupStat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, color: warn ? '#a1791f' : '#14532d' }}>{value}</div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 9.5, color: '#9ca3af' }}>{label}</div>
    </div>
  )
}
