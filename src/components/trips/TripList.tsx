'use client'

import React, { useState } from 'react'
import { useMyTrips } from '@/lib/queries/trips'
import TripCard from './TripCard'
import type { TripSummary } from '@/types/app'

type FilterTab = 'active' | 'completed' | 'archived'

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'active',    label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'archived',  label: 'Archived' },
]

const ACTIVE_STATUSES    = ['draft', 'open', 'groups_ready', 'ready', 'live']
const COMPLETED_STATUSES = ['completed']
const ARCHIVED_STATUSES  = ['archived']

function filterTrips(trips: TripSummary[], tab: FilterTab): TripSummary[] {
  if (tab === 'active')    return trips.filter(t => ACTIVE_STATUSES.includes(t.status))
  if (tab === 'completed') return trips.filter(t => COMPLETED_STATUSES.includes(t.status))
  if (tab === 'archived')  return trips.filter(t => ARCHIVED_STATUSES.includes(t.status))
  return trips
}

// Section label within the active trips list
function groupLabel(trips: TripSummary[]): { upcoming: TripSummary[]; live: TripSummary[] } {
  const now = new Date().toISOString().split('T')[0]
  return {
    live:     trips.filter(t => t.status === 'live'),
    upcoming: trips.filter(t => t.status !== 'live'),
  }
}

const EMPTY_STATES: Record<FilterTab, { icon: string; title: string; body: string }> = {
  active: {
    icon:  '⛳',
    title: 'No active trips yet',
    body:  'Create your first event and invite your crew. The tee is waiting.',
  },
  completed: {
    icon:  '🏆',
    title: 'No completed events yet',
    body:  'Finish your first event and celebrate your results here.',
  },
  archived: {
    icon:  '📁',
    title: 'No archived trips',
    body:  'Archive a trip to remove it from your active list while keeping all its data.',
  },
}

function TripCardSkeleton() {
  return (
    <div className="bg-ivory rounded-card border border-parchment-dark p-4 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="skeleton skeleton-avatar w-14 h-14 rounded-2xl" />
        <div className="flex-1 space-y-2 py-1">
          <div className="skeleton skeleton-title w-2/3" />
          <div className="skeleton skeleton-text w-1/2" />
          <div className="flex gap-2 mt-2">
            <div className="skeleton h-3 w-16 rounded-full" />
            <div className="skeleton h-3 w-12 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function TripList() {
  const [filter, setFilter] = useState<FilterTab>('active')
  const { data: trips, isLoading, error } = useMyTrips()

  const filtered   = filterTrips(trips ?? [], filter)
  const activeCount = filterTrips(trips ?? [], 'active').length

  if (isLoading) {
    return (
      <div className="space-y-3">
        {/* Tab skeleton */}
        <div className="skeleton h-10 w-full rounded-xl" />
        {[1, 2, 3].map(i => <TripCardSkeleton key={i} />)}
      </div>
    )
  }

  if (error) {
    const message = error instanceof Error ? error.message : String(error)
    return (
      <div className="rounded-card bg-red-50 border border-red-100 p-5 text-center space-y-2">
        <p className="text-sm font-semibold text-red-600">Couldn&apos;t load trips</p>
        <p className="text-xs text-red-400 font-mono break-all">{message}</p>
      </div>
    )
  }

  const empty = EMPTY_STATES[filter as FilterTab]
  const { live, upcoming } = groupLabel(filtered)

  return (
    <div className="space-y-3">
      {/* Filter tabs */}
      <div style={{
        display: 'flex',
        background: '#f2e8d0',
        borderRadius: 12,
        padding: 3,
        gap: 2,
      }}>
        {TABS.map(({ key, label }) => {
          const count = filterTrips(trips ?? [], key).length
          const active = filter === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className="flex-1 transition-all duration-150 active:scale-95"
              style={{
                padding: '8px 4px',
                borderRadius: 9,
                border: 'none',
                background: active ? '#f8f4eb' : 'transparent',
                boxShadow: active ? '0 1px 6px rgba(15,45,28,0.08)' : 'none',
                fontFamily: 'var(--font-body)',
                fontSize: 12.5,
                fontWeight: active ? 700 : 500,
                color: active ? '#1a4731' : '#7a7260',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
              }}
            >
              {label}
              {count > 0 && (
                <span style={{
                  background: active ? '#1a4731' : '#d9c9a3',
                  color: active ? '#e8c96a' : '#7a7260',
                  borderRadius: 10,
                  padding: '1px 6px',
                  fontSize: 10,
                  fontWeight: 700,
                }}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Trip cards */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 px-4 text-center animate-fadeIn">
          <span style={{ fontSize: 44, marginBottom: 12 }}>{empty.icon}</span>
          <h3 style={{
            fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700,
            color: '#1a1a16', marginBottom: 6,
          }}>{empty.title}</h3>
          <p style={{
            fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260',
            maxWidth: 260, lineHeight: 1.55,
          }}>{empty.body}</p>
          {filter === 'active' && (
            <a
              href="/trips/new"
              className="mt-5 active:scale-95 transition-transform"
              style={{
                background: 'linear-gradient(160deg, #2d7a52 0%, #1a4731 100%)',
                color: '#ffffff',
                borderRadius: 12, padding: '11px 22px',
                fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
                textDecoration: 'none',
                boxShadow: '0 4px 14px rgba(26,71,49,0.35)',
              }}
            >
              + Create your first event
            </a>
          )}
        </div>
      ) : (
        <div className="space-y-3 stagger">
          {/* Live trips first with a label */}
          {live.length > 0 && (
            <>
              <div className="s-label px-1 pt-1">🔴 Live now</div>
              {live.map(trip => (
                <div key={trip.id} className="animate-fadeUp ring-2 ring-green-400 rounded-card">
                  <TripCard trip={trip} />
                </div>
              ))}
              {upcoming.length > 0 && <div className="s-label px-1 pt-1">Upcoming</div>}
            </>
          )}
          {upcoming.map(trip => (
            <div key={trip.id} className="animate-fadeUp">
              <TripCard trip={trip} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
