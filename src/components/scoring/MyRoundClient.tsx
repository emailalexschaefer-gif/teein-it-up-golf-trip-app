'use client'

import { useState, useEffect } from 'react'
import RoundSchedule, { type ScheduleRound } from './RoundSchedule'
import PlayerRoundView from './PlayerRoundView'
import MyGolfEventStory from './MyGolfEventStory'
import MyAchievementsSection from './MyAchievementsSection'
import MyBadgesSection from './MyBadgesSection'
import MyEventStoriesSection from './MyEventStoriesSection'
import { trackEvent } from '@/lib/analytics/trackEvent'

/**
 * My Golf brief (31 Aug) — "MY GOLF = MY GOLF LIFE." Reorganised per
 * the explicit new information hierarchy (item 2):
 *   1. My Achievements  (always — reuses the same canonical summary
 *      Home's card already fetches, never recalculated independently)
 *   2. My Badges         (always — self-shows an honest empty state)
 *   3. My Event Stories   (the just-finished-event celebration banner,
 *      when the whole event has JUST completed, followed by the
 *      permanent chronological index of every completed event — two
 *      genuinely different things, not a duplicate: the banner is a
 *      rich, one-time "fresh recap," the index is a lightweight,
 *      permanent list. Neither reimplements Event Story itself.)
 *   4. Current / Upcoming Golf (the existing round schedule/performance
 *      view, preserved in full — repositioned and reframed under its
 *      own heading, per the explicit "reposition/reframe... do not
 *      remove" instruction, not rebuilt.)
 *
 * Item 12 — "View My Golf →" from Home already lands at the top of
 * this exact component (same route, same order), so a player now sees
 * My Achievements first, not the round schedule — satisfied by this
 * reordering alone, no separate routing change needed.
 *
 * Item 9's own reasoning (below) is unchanged — selectedRoundId is
 * still plain useState, a manual tap is still the only thing that
 * changes it after mount.
 */
export default function MyRoundClient({
  tripId, rounds, defaultRoundId, eventFullyComplete = false, currentPlayerId,
}: {
  tripId: string; rounds: ScheduleRound[]; defaultRoundId: string | null
  // Release 2, item 6 — My Golf Event Story. Both optional so any
  // existing caller not yet updated to pass them still compiles and
  // behaves exactly as before (no Event Story section rendered).
  eventFullyComplete?: boolean
  currentPlayerId?: string
}) {
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(defaultRoundId)
  const selected = rounds.find(r => r.id === selectedRoundId) ?? null

  // GA4 / Product Analytics brief — "how often My Golf is opened."
  // Once per mount only, not on every round switch within the same
  // visit (that's a different, narrower interaction, not "opened My
  // Golf" again).
  useEffect(() => {
    trackEvent('my_golf_opened', { tripId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <MyAchievementsSection />
      <MyBadgesSection />

      {/* Release 2, item 6 — shown ABOVE the event-stories index, only
          once the whole event (not just the round currently selected
          below) is fully complete. This is deliberately the FIRST
          thing a player sees for a just-finished event — "a permanent
          chapter in My Golf" — not something they have to scroll past
          the ordinary round view to find. */}
      {eventFullyComplete && currentPlayerId && (
        <MyGolfEventStory tripId={tripId} playerId={currentPlayerId} />
      )}

      <MyEventStoriesSection />

      {/* My Golf brief, item 11 — "Current / Upcoming Golf." The exact
          same RoundSchedule/PlayerRoundView experience as before,
          preserved in full, simply given its own heading and moved
          below the achievement/badge/story content above it — not
          rebuilt, not removed. */}
      <div style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 15, fontWeight: 800, marginBottom: 10 }}>
        Current / Upcoming Golf
      </div>
      <RoundSchedule
        rounds={rounds} selectedRoundId={selectedRoundId ?? ''} defaultRoundId={defaultRoundId}
        onSelect={setSelectedRoundId} tripId={tripId}
      />
      {selected ? (
        <PlayerRoundView
          tripId={tripId} roundId={selected.id} roundStatus={selected.status}
          roundName={selected.name} courseName={selected.course_name} playDate={selected.play_date}
          teeTime={selected.tee_time} groupsReleased={selected.setup_released ?? false}
        />
      ) : (
        <div style={{ textAlign: 'center', padding: '32px 16px', fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13 }}>
          Your organiser hasn&apos;t set up any rounds yet.
        </div>
      )}
    </div>
  )
}
