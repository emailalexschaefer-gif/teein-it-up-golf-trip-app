'use client'

// Sprint 5C navigation architecture — the persistent "live event" nav,
// distinct from the top trip-management tabs (Overview/Players/Groups/
// Rounds, unchanged, still in TripDetailClient). This bar lives in
// (app)/trips/[tripId]/layout.tsx, which is why it automatically appears
// on every route nested under a trip — including the scoring pages under
// rounds/[roundId] — without those pages needing to render it themselves.
//
// Mobile: fixed to the bottom of the viewport. Desktop (md breakpoint and
// up): hidden here entirely — DesktopTripNav (rendered alongside this in
// the same layout) takes over at that width, so the two are never both
// visible at once.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useScoringFocusStore } from '@/store/scoringFocusStore'

interface NavItem { href: string; label: string; icon: string; match: (path: string) => boolean }

function buildItems(tripId: string, isOrganiser: boolean, activeRoundId: string | null): NavItem[] {
  const base = `/trips/${tripId}`
  const scorecardHref = activeRoundId ? `${base}/rounds/${activeRoundId}` : base
  const items: NavItem[] = [
    { href: base, label: 'Home', icon: '🏠', match: (p) => p === base },
    // Highest-frequency destination during live play (players visit this
    // for every hole, every round — far more often than any other
    // destination), so it sits right after Home rather than being buried
    // further down the bar.
    { href: scorecardHref, label: 'Scorecard', icon: '⛳', match: (p) => p.startsWith(`${base}/rounds`) },
    { href: `${base}/leaderboard`, label: 'Leaderboard', icon: '🏆', match: (p) => p.startsWith(`${base}/leaderboard`) },
    { href: `${base}/sidegames`, label: 'Side Games', icon: '🎯', match: (p) => p.startsWith(`${base}/sidegames`) },
  ]
  // Same nav position and route for both roles — label and destination
  // content adapt by role instead of adding a second bottom-nav item.
  items.push({ href: `${base}/tournament`, label: isOrganiser ? 'My HQ' : 'My Round', icon: '🎛️', match: (p) => p.startsWith(`${base}/tournament`) })
  items.push({ href: `${base}/chat`, label: 'Chat', icon: '💬', match: (p) => p.startsWith(`${base}/chat`) })
  return items
}

export function TripBottomNav({ tripId, isOrganiser, activeRoundId }: { tripId: string; isOrganiser: boolean; activeRoundId: string | null }) {
  const pathname = usePathname() ?? ''
  const items = buildItems(tripId, isOrganiser, activeRoundId)
  const [hasUnread, setHasUnread] = useState(false)
  const scoringFocusActive = useScoringFocusStore(s => s.isActive)

  // Reuses the existing messages endpoint — no new API for this. No
  // refetchInterval: checked on mount and on window focus only, per the
  // explicit "do not introduce unnecessary polling" constraint.
  const { data } = useQuery<{ messages: { created_at: string }[] }>({
    queryKey: ['event-messages', tripId],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/messages`)
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    refetchOnWindowFocus: true,
    staleTime: 30000,
  })

  useEffect(() => {
    if (!data || data.messages.length === 0) return
    const lastRead = window.localStorage.getItem(`chat-last-read-${tripId}`)
    setHasUnread(!lastRead || data.messages[0].created_at > lastRead)
  }, [data, tripId])

  // Hidden during active scoring — the dedicated scoring focus action
  // tray replaces this. Round Summary and every other trip screen are
  // unaffected.
  if (scoringFocusActive) return null

  return (
    <nav
      className="md:hidden"
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
        background: 'linear-gradient(135deg,#0f2d1c 0%,#172d1f 100%)',
        borderTop: '2px solid #c9a84c',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        boxShadow: '0 -4px 20px rgba(0,0,0,0.3)',
      }}
    >
      <div style={{ display: 'flex' }}>
        {items.map((item) => {
          const active = item.match(pathname)
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 2, padding: '8px 4px 6px', textDecoration: 'none',
                minHeight: 52, position: 'relative',
              }}
            >
              <span style={{ fontSize: 20, lineHeight: 1, filter: active ? 'none' : 'grayscale(40%) opacity(0.7)', position: 'relative' }}>
                {item.icon}
                {item.label === 'Chat' && hasUnread && (
                  <span style={{ position: 'absolute', top: -2, right: -4, width: 8, height: 8, borderRadius: '50%', background: '#dc2626', border: '1.5px solid #0f2d1c' }} />
                )}
              </span>
              <span style={{
                fontFamily: 'var(--font-body)', fontSize: 9.5, fontWeight: active ? 800 : 600,
                color: active ? '#e8c96a' : 'rgba(245,230,184,0.45)',
              }}>
                {item.label}
              </span>
              {active && (
                <span style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: 28, height: 2.5, borderRadius: 2, background: '#e8c96a' }} />
              )}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

export function DesktopTripNav({ tripId, isOrganiser, activeRoundId }: { tripId: string; isOrganiser: boolean; activeRoundId: string | null }) {
  const pathname = usePathname() ?? ''
  const items = buildItems(tripId, isOrganiser, activeRoundId)
  const scoringFocusActive = useScoringFocusStore(s => s.isActive)
  if (scoringFocusActive) return null

  return (
    <div className="hidden md:flex" style={{
      alignItems: 'center', gap: 4, padding: '8px 16px',
      background: '#f7f6f1', borderBottom: '1px solid #eceae3',
    }}>
      {items.map((item) => {
        const active = item.match(pathname)
        return (
          <Link
            key={item.href}
            href={item.href}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 20, textDecoration: 'none',
              background: active ? '#fdf3d9' : 'transparent',
              border: active ? '1.5px solid #e8c96a' : '1.5px solid transparent',
            }}
          >
            <span style={{ fontSize: 14 }}>{item.icon}</span>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: active ? 800 : 600, color: active ? '#a1791f' : '#6b7280' }}>
              {item.label}
            </span>
          </Link>
        )
      })}
    </div>
  )
}
