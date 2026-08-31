'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { trackEvent } from '@/lib/analytics/trackEvent'

/**
 * Homepage "My Golf" achievement summary.
 *
 * Placement: below Join a Trip, above My Events (Home/dashboard page
 * itself — this component owns none of that layout decision, it's
 * just dropped in at the right spot there).
 *
 * Data: one API call (/api/me/golf-summary), which itself is one RPC
 * round-trip server-side (migration 068) — no N+1 pattern on Home
 * load, per the explicit performance requirement.
 *
 * Architected for future gamification WITHOUT needing a redesign when
 * it arrives (explicit requirement — read this before changing the
 * layout below): the three-stat row and the optional header slot above
 * it are already structurally separate. A future tier/points header
 * (🥈 AMATEUR SILVER / 1,840 TIU POINTS / progress bar) is meant to
 * slot in as an additional block ABOVE the existing stat row, not
 * replace it — the stat row itself (events/badges/wins) is the stable,
 * permanent part of this card. When that data model exists, add a new
 * conditional header block here; do not restructure what's below it.
 */

interface GolfSummary {
  eventsPlayed: number
  badges: number
  eventWins: number
  sideGameWins: number
  latestBadgeTitle: string | null
  mostRecentTripId: string | null
}

function StatBlock({ value, label, onClick }: { value: number; label: string; onClick: () => void }) {
  return (
    // One little UX choice locked in per the brief: the whole stat
    // block (number + label), not just the tiny "View achievements"
    // text, is the tap target — generous touch area matters on a golf
    // course, not just visual hierarchy.
    <button
      onClick={onClick}
      style={{
        flex: 1, background: 'none', border: 'none', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        padding: '4px 2px',
      }}
    >
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, color: '#14532d', lineHeight: 1 }}>
        {value}
      </span>
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#7a7260', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </span>
    </button>
  )
}

export default function MyGolfSummaryCard() {
  const [expanded, setExpanded] = useState(false)

  const { data, isLoading } = useQuery<GolfSummary>({
    queryKey: ['my-golf-summary'],
    queryFn: async () => {
      const res = await fetch('/api/me/golf-summary')
      if (!res.ok) throw new Error('Could not load summary.')
      return res.json()
    },
    staleTime: 60000,
  })

  // Silent on load/error — this is a bonus dopamine layer, not primary
  // page content; a slow or failed fetch should never block or clutter
  // the homepage while My Events (the actually essential content)
  // loads normally beneath it.
  if (isLoading || !data) return null

  const isNewPlayer = data.eventsPlayed === 0 && data.badges === 0 && data.eventWins === 0

  function toggle() {
    const next = !expanded
    setExpanded(next)
    // GA4 brief — meaningful toggles only, not fired on every render.
    trackEvent(next ? 'my_golf_summary_expanded' : 'my_golf_summary_collapsed')
  }

  return (
    <div style={{
      background: 'linear-gradient(135deg,#14532d,#1a6b3a)', borderRadius: 16,
      padding: '16px 18px', border: '1px solid rgba(232,201,106,0.25)',
    }}>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: '#e8c96a', marginBottom: isNewPlayer ? 4 : 10 }}>
        ⛳ My Golf
      </div>

      {/* Empty/new-player state — per the explicit "do not show a
          depressing wall of 0 | 0 | 0 without context" requirement.
          The numbers still show (never fabricated, just genuinely
          zero), but framed with encouraging copy rather than presented
          as a bare, context-free stat row. */}
      {isNewPlayer && (
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'rgba(255,255,255,0.75)', marginBottom: 10 }}>
          Your golf story starts here.
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        <StatBlock value={data.eventsPlayed} label="Events" onClick={toggle} />
        <div style={{ width: 1, background: 'rgba(232,201,106,0.25)', margin: '2px 0' }} />
        <StatBlock value={data.badges} label="Badges" onClick={toggle} />
        <div style={{ width: 1, background: 'rgba(232,201,106,0.25)', margin: '2px 0' }} />
        <StatBlock value={data.eventWins} label="Wins" onClick={toggle} />
      </div>

      <button
        onClick={toggle}
        style={{
          display: 'block', width: '100%', textAlign: 'center', background: 'none', border: 'none',
          fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: 'rgba(232,201,106,0.85)',
          cursor: 'pointer', marginTop: 8, padding: '4px 0',
        }}
      >
        {expanded ? 'Hide achievements ↑' : 'View achievements ↓'}
      </button>

      {expanded && (
        <div style={{ marginTop: 6, paddingTop: 12, borderTop: '1px solid rgba(232,201,106,0.2)' }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 9.5, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
            My Achievements
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: data.latestBadgeTitle ? 10 : 12 }}>
            <AchievementRow icon="🏆" label="Event Wins" value={data.eventWins} />
            <AchievementRow icon="🎯" label="Side Game Wins" value={data.sideGameWins} />
            <AchievementRow icon="🏅" label="Badges Earned" value={data.badges} />
            <AchievementRow icon="⛳" label="Events Played" value={data.eventsPlayed} />
          </div>
          {/* "Only show if the current data model can reliably
              determine it" — latestBadgeTitle is null whenever no
              published highlight exists for this player at all; never
              a fabricated placeholder. */}
          {data.latestBadgeTitle && (
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, color: '#e8c96a', marginBottom: 12 }}>
              🔥 Latest: {data.latestBadgeTitle}
            </div>
          )}
          {data.mostRecentTripId && (
            <Link
              href={`/trips/${data.mostRecentTripId}/tournament`}
              onClick={() => trackEvent('my_golf_opened', { source: 'homepage_summary' })}
              style={{
                display: 'block', textAlign: 'center', background: 'rgba(232,201,106,0.12)',
                border: '1px solid rgba(232,201,106,0.35)', borderRadius: 10, padding: '9px 12px',
                fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, color: '#e8c96a',
                textDecoration: 'none',
              }}
            >
              View My Golf →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

function AchievementRow({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'rgba(255,255,255,0.9)' }}>
        {icon} {label}
      </span>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 800, color: '#fff' }}>
        {value}
      </span>
    </div>
  )
}
