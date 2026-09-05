'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import RoundSchedule, { type ScheduleRound } from './RoundSchedule'
import PlayerRoundView from './PlayerRoundView'
import MyGolfEventStory from './MyGolfEventStory'
import MyAchievementsSection from './MyAchievementsSection'
import MyBadgesSection from './MyBadgesSection'
import MyEventStoriesSection from './MyEventStoriesSection'
import CollapsibleSection from '@/components/shared/CollapsibleSection'
import { trackEvent } from '@/lib/analytics/trackEvent'
import type { BadgeType } from '@/app/api/me/badges/route'

/**
 * My Golf + My HQ UX Cleanup brief (5 Sep) — final ordering:
 *   1. My Achievements (visible), My Badges expandable within it
 *   2. Current / Upcoming Golf (visible)
 *   3. Results Are Ready — this is PlayerRoundView's own existing
 *      "published" status banner (STATUS_META['published'] = "Results
 *      are ready"), already rendered unconditionally at the top of
 *      whatever PlayerRoundView shows for the selected round — no
 *      separate component needed, since that banner already IS this
 *      requirement, already visible, already correct.
 *   4. Your Event Story — collapsed by default
 *   5. Recap Round — collapsed by default (implemented inside
 *      PlayerRoundView itself, see that file's own comment — the
 *      status banner and any "needs your attention" alert stay
 *      outside/visible; everything else moves into this one wrapper)
 *   6. My Event Stories — unchanged, own ordering logic already lives
 *      in that component
 *
 * This is a presentation/ordering change only — every data source,
 * query, and calculation below is exactly the one already in use
 * before this package.
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

  // Same queryKey ['my-badges'] MyBadgesSection itself uses — React
  // Query dedupes identical concurrent queries by key, so this is not
  // a second network request, only a second subscriber to the one
  // MyBadgesSection already makes. Needed here only for the count
  // shown in the collapsible header itself; MyBadgesSection's own
  // internals are otherwise completely unchanged.
  const { data: badgesData } = useQuery<{ badgeTypes: BadgeType[] }>({
    queryKey: ['my-badges'],
    queryFn: async () => {
      const res = await fetch('/api/me/badges')
      if (!res.ok) throw new Error('Could not load badges.')
      return res.json()
    },
    staleTime: 60000,
  })

  return (
    <div>
      {/* 1. MY ACHIEVEMENTS — visible, My Badges expandable within it */}
      <MyAchievementsSection />
      <CollapsibleSection icon="🏅" title="My Badges" count={badgesData?.badgeTypes.length ?? 0}>
        <MyBadgesSection />
      </CollapsibleSection>

      {/* 2. CURRENT / UPCOMING GOLF — visible, unchanged experience.
          3. RESULTS ARE READY lives inside PlayerRoundView's own
          status banner below (see this file's own top comment). */}
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

      {/* 4. YOUR EVENT STORY — collapsed by default. Only rendered at
          all once the whole event is fully complete, exactly as
          before — this package only changes WHERE/HOW it's shown
          (collapsed, not always-open), never whether or what. */}
      {eventFullyComplete && currentPlayerId && (
        <CollapsibleSection icon="📖" title="Your Event Story">
          <MyGolfEventStory tripId={tripId} playerId={currentPlayerId} />
        </CollapsibleSection>
      )}

      {/* 6. MY EVENT STORIES — historical archive, unchanged. */}
      <MyEventStoriesSection />
    </div>
  )
}
