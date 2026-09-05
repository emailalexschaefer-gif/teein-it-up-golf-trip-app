'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import RoundSchedule, { type ScheduleRound } from './RoundSchedule'
import TournamentControl from './TournamentControl'
import RoundHighlightsCard from './RoundHighlightsCard'
import MyRoundSummary from './MyRoundSummary'
import CollapsibleSection from '@/components/shared/CollapsibleSection'
import { trackEvent } from '@/lib/analytics/trackEvent'

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
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(defaultRoundId)
  const selected = rounds.find(r => r.id === selectedRoundId) ?? null

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

      {selected?.status === 'completed' && (
        <RoundHighlightsCard tripId={tripId} roundId={selected.id} roundName={selected.name} />
      )}

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
