'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { trackEvent } from '@/lib/analytics/trackEvent'

interface EventStoryIndexItem {
  tripId: string
  tripName: string
  courses: string[]
  startDate: string | null
  endDate: string | null
  badgeCount: number
  sideGameWinCount: number
}

function formatRange(start: string | null, end: string | null): string {
  if (!start) return ''
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  const s = new Date(start + 'T00:00:00').toLocaleDateString('en-US', opts)
  if (!end || end === start) return s
  const e = new Date(end + 'T00:00:00').toLocaleDateString('en-US', { ...opts, year: 'numeric' })
  return `${s} – ${e}`
}

/**
 * My Golf brief, item 9 — a chronological index of completed events,
 * each a "chapter" linking into the EXISTING per-trip Event Story
 * (MyGolfEventStory.tsx, already built and unchanged) — this component
 * never renders Event Story content itself, only the index card. Per
 * item 17, only summary data loads here (name, courses, date range,
 * two counts) — the richer Event Story payload for any one trip only
 * loads once the player actually taps into it.
 */
export default function MyEventStoriesSection() {
  const { data, isLoading } = useQuery<{ eventStories: EventStoryIndexItem[] }>({
    queryKey: ['my-event-stories'],
    queryFn: async () => {
      const res = await fetch('/api/me/event-stories')
      if (!res.ok) throw new Error('Could not load event stories.')
      return res.json()
    },
    staleTime: 60000,
  })

  if (isLoading) return null
  const stories = data?.eventStories ?? []
  if (stories.length === 0) return null // no completed events yet — nothing to show, not an empty-state banner (the badges section above already carries that messaging)

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 15, fontWeight: 800, marginBottom: 10 }}>
        My Event Stories
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {stories.map(story => (
          <Link
            key={story.tripId}
            href={`/trips/${story.tripId}/tournament`}
            onClick={() => trackEvent('event_story_opened', { tripId: story.tripId, source: 'my_golf_index' })}
            style={{
              display: 'block', background: '#fff', border: '1px solid #eceae3', borderRadius: 12,
              padding: '13px 14px', textDecoration: 'none',
            }}
          >
            <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, color: '#14532d' }}>
              {story.tripName}
            </div>
            {story.courses.length > 0 && (
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#7a7260', marginTop: 2 }}>
                {story.courses.join(' / ')}
              </div>
            )}
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#9ca3af', marginTop: 1 }}>
              {formatRange(story.startDate, story.endDate)}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              {story.badgeCount > 0 && (
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#a1791f' }}>
                  🏅 {story.badgeCount} Badge{story.badgeCount === 1 ? '' : 's'}
                </span>
              )}
              {story.sideGameWinCount > 0 && (
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#a1791f' }}>
                  🎯 {story.sideGameWinCount} Side Game Win{story.sideGameWinCount === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#14532d', marginTop: 8 }}>
              View Event Story →
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
