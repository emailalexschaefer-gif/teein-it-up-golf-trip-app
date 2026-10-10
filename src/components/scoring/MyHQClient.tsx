'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import RoundSchedule, { type ScheduleRound } from './RoundSchedule'
import TournamentControl from './TournamentControl'
import RoundHighlightsCard from './RoundHighlightsCard'
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

  // Each action just routes the organiser to the existing control that
  // already performs it — this never invents a parallel start/close/
  // review flow. Close Round and Makers & Breakers scroll to their
  // existing in-page sections (anchored below); Start Round and
  // Review & Present route to the existing pages that already handle
  // them.
  function handleWorkflowAction(stageId: WorkflowStageId) {
    if (stageId === 'start') { router.push(`/trips/${tripId}?tab=rounds`); return }
    if (stageId === 'close') { document.getElementById('close-round-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return }
    if (stageId === 'makersBreakers') { document.getElementById('makers-breakers-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return }
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
      {selected && workflow && (
        <div style={{ marginBottom: 16 }}>
          <RoundWorkflowTracker
            roundName={selected.name}
            stages={workflow.stages}
            primaryStageId={workflow.primaryStageId}
            onAction={handleWorkflowAction}
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

      {/* My HQ V2 (10 Oct) — stable scroll target for the Guided
          Workflow tracker's "Select Makers & Breakers"/"Review
          Makers & Breakers" action. Wraps the existing entry point
          unchanged; this is purely an additional anchor. */}
      <div id="makers-breakers-section">
        {selected?.status === 'completed' && (
          <RoundHighlightsCard tripId={tripId} roundId={selected.id} roundName={selected.name} />
        )}
      </div>

      {selected ? (
        <>
          <TournamentControl tripId={tripId} roundId={selected.id} roundStatus={selected.status} />

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
