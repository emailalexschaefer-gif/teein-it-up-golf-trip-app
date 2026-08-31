'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { selectPlayerEventStory, type EventHighlight } from '@/lib/highlights/eventMakersBreakers'
import { trackEvent } from '@/lib/analytics/trackEvent'

/**
 * Release 2, item 6 — My Golf Event Story.
 *
 * Deliberately fetches the exact same /api/trips/[tripId]/final-results
 * endpoint My HQ's Final Results screen already calls (item 5) — the
 * SAME generateEventMakersAndBreakers output, computed once server-side.
 * This component only ever filters it down to the logged-in player via
 * selectPlayerEventStory (also reused, not reimplemented); it never
 * recomputes anything itself. "My HQ and My Golf consume the same
 * canonical event-highlight result" is satisfied by construction — this
 * literally is the same HTTP response, not a parallel calculation that
 * could drift out of sync with it.
 *
 * Only rendered by MyRoundClient when the whole EVENT (not just the
 * currently-viewed round) is fully complete — a mid-event player has no
 * "event story" yet, only round-by-round progress, which the existing
 * round view below this component already shows.
 */
interface FinalResultsForStory {
  tripName: string
  standings: { playerId: string; playerName: string; totalPoints: number; position: number; roundsPlayed: number }[]
  eventHighlights: { makers: EventHighlight[]; breakers: EventHighlight[] }
}

export default function MyGolfEventStory({ tripId, playerId }: { tripId: string; playerId: string }) {
  const { data, isLoading } = useQuery<FinalResultsForStory>({
    queryKey: ['final-results', tripId],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/final-results`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not load event story.')
      return body
    },
    // Final and locked, same reasoning FinalEventResults.tsx already
    // uses for this same endpoint — no need to poll a completed event.
    staleTime: 60000,
  })

  if (isLoading || !data) return null // silent — this is a bonus section, not the primary content of the page; a load failure here shouldn't block the round view beneath it

  const myStanding = data.standings.find(s => s.playerId === playerId)
  const myStoryBeats = selectPlayerEventStory(data.eventHighlights, playerId, 5)

  // Nothing meaningful to show for this player at all (e.g. they only
  // appear in a round that got excluded, or genuinely qualified for no
  // event-level highlight) — omit the section entirely rather than an
  // empty shell.
  if (!myStanding && myStoryBeats.length === 0) return null

  return <MyGolfEventStoryContent tripName={data.tripName} myStanding={myStanding} myStoryBeats={myStoryBeats} tripId={tripId} />
}

// GA4 / Product Analytics brief — "how often is Event Story opened."
// Split into its own inner component specifically so this only fires
// once real content is genuinely about to render — not on every mount
// attempt, including the (common) case where the component mounts but
// then immediately returns null above because there's nothing to show
// for this player yet.
function MyGolfEventStoryContent({
  tripId, tripName, myStanding, myStoryBeats,
}: {
  tripId: string; tripName: string
  myStanding: FinalResultsForStory['standings'][number] | undefined
  myStoryBeats: EventHighlight[]
}) {
  useEffect(() => {
    trackEvent('event_story_opened', { tripId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div style={{ background: 'linear-gradient(135deg,#14532d,#1a6b3a)', borderRadius: 16, padding: '22px 18px', marginBottom: 20 }}>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: '#e8c96a', textAlign: 'center' }}>
        📖 Your Event Story
      </div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginTop: 2 }}>
        {tripName}
      </div>

      {myStanding && (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 900, color: '#fff' }}>
            {ordinal(myStanding.position)}
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'rgba(255,255,255,0.85)' }}>
            {myStanding.totalPoints} pts across {myStanding.roundsPlayed} round{myStanding.roundsPlayed === 1 ? '' : 's'}
          </div>
        </div>
      )}

      {myStoryBeats.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
          {myStoryBeats.map(beat => (
            <div key={beat.category} style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: beat.kind === 'maker' ? '#e8c96a' : '#f0a8a8' }}>
                {beat.kind === 'maker' ? '🔥' : '💥'} {beat.title}
              </div>
              {beat.definition && (
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: 'rgba(255,255,255,0.75)', marginTop: 3 }}>
                  {beat.definition}
                </div>
              )}
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#fff', marginTop: 4, fontWeight: 600 }}>
                {beat.statLine}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}
