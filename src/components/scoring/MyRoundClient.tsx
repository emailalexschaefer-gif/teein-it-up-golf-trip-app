'use client'

import { useState } from 'react'
import RoundSchedule, { type ScheduleRound } from './RoundSchedule'
import PlayerRoundView from './PlayerRoundView'
import MyGolfEventStory from './MyGolfEventStory'

/**
 * Item 9 — "once the player manually taps another round, do not
 * immediately force them back to the automatic current round during
 * the same page interaction." selectedRoundId is plain useState,
 * initialised once from defaultRoundId and never overwritten by any
 * effect that re-runs the automatic-selection rule — a manual tap is
 * the only thing that ever changes it after mount.
 *
 * PlayerRoundView is keyed by roundId internally (its own useQuery
 * queryKey already includes roundId) — changing which round is
 * selected here naturally triggers a fresh fetch for that round's own
 * data, so "My Performance"/"My Group"/etc. becoming round-specific
 * falls out of the existing data-fetching architecture rather than
 * needing new plumbing.
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

  return (
    <div>
      {/* Release 2, item 6 — shown ABOVE the round-by-round view, only
          once the whole event (not just the round currently selected
          below) is fully complete. This is deliberately the FIRST thing
          a player sees here once the event is over — "a permanent
          chapter in My Golf," not something they have to scroll past
          the ordinary round view to find. Round-by-round context
          remains fully available underneath via the existing
          RoundSchedule/PlayerRoundView below, unchanged. */}
      {eventFullyComplete && currentPlayerId && (
        <MyGolfEventStory tripId={tripId} playerId={currentPlayerId} />
      )}
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
