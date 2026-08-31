'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { trackEvent } from '@/lib/analytics/trackEvent'
import type { BadgeType } from '@/app/api/me/badges/route'

/**
 * My Golf brief, items 4/5/6/8 — the permanent badge collection.
 *
 * Two distinct concepts, kept structurally separate per the explicit
 * instruction: a BADGE TYPE (the career collection — "Iceman ×5") is
 * the top-level list; a BADGE INSTANCE (one specific occasion) only
 * appears once a type is tapped open. Tapping an instance deep-links to
 * that event's own Event Story (via the trip's existing tournament
 * page) — "the badge answers what; the instance answers where/when;
 * Event Story answers what happened."
 */
function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function MyBadgesSection() {
  const [openType, setOpenType] = useState<string | null>(null)

  const { data, isLoading } = useQuery<{ badgeTypes: BadgeType[] }>({
    queryKey: ['my-badges'],
    queryFn: async () => {
      const res = await fetch('/api/me/badges')
      if (!res.ok) throw new Error('Could not load badges.')
      return res.json()
    },
    staleTime: 60000,
  })

  if (isLoading) return null

  const badgeTypes = data?.badgeTypes ?? []

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 15, fontWeight: 800, marginBottom: 10 }}>
        My Badges
      </div>

      {badgeTypes.length === 0 ? (
        // Data integrity — never fabricate a badge that wasn't
        // genuinely published for this player. A player with none yet
        // sees an honest, encouraging empty state instead.
        <div style={{ background: '#fff', border: '1px dashed #d9c9a3', borderRadius: 12, padding: '18px 16px', textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af' }}>
            No badges yet — play an event to start your collection.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {badgeTypes.map(type => (
            <div key={type.category} style={{ background: '#fff', border: '1px solid #eceae3', borderRadius: 12, overflow: 'hidden' }}>
              <button
                onClick={() => setOpenType(openType === type.category ? null : type.category)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                  padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, color: '#14532d' }}>
                  {type.icon} {type.title} <span style={{ color: '#a1791f' }}>×{type.count}</span>
                </span>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#9ca3af' }}>
                  {openType === type.category ? '▲' : '▼'}
                </span>
              </button>

              {openType === type.category && (
                <div style={{ borderTop: '1px solid #f3f4f1' }}>
                  {type.instances.map((instance, i) => (
                    <Link
                      key={`${instance.tripId}-${instance.roundId}-${i}`}
                      href={`/trips/${instance.tripId}/tournament`}
                      onClick={() => trackEvent('my_golf_opened', { source: 'badge_instance' })}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '11px 14px', textDecoration: 'none',
                        borderBottom: i < type.instances.length - 1 ? '1px solid #f3f4f1' : 'none',
                      }}
                    >
                      <div>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#14532d', fontWeight: 600 }}>
                          📍 {instance.courseName ?? instance.tripName}
                        </div>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#9ca3af', marginTop: 1 }}>
                          📅 {formatDate(instance.playDate)}
                        </div>
                      </div>
                      <span style={{ color: '#d9c9a3', fontSize: 14 }}>→</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
