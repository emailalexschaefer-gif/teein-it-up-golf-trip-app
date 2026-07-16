'use client'

import React, { useState } from 'react'
import { useMyTrips } from '@/lib/queries/trips'
import TripCard from './TripCard'
import type { TripSummary } from '@/types/app'

type FilterTab = 'active' | 'completed' | 'archived'

export default function TripList() {
  const [filter, setFilter] = useState<FilterTab>('active')
  const { data: trips, isLoading, error } = useMyTrips()

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-2xl bg-parchment animate-pulse" />
        ))}
      </div>
    )
  }

  if (error) {
    const message = error instanceof Error ? error.message : String(error)
    return (
      <div className="rounded-2xl bg-red-50 border border-red-100 p-6 text-center space-y-2">
        <p className="text-sm font-medium text-red-600">Couldn&apos;t load trips.</p>
        <p className="text-xs text-red-500 font-mono break-all">{message}</p>
        <p className="text-xs text-red-400">Check Vercel runtime logs for more detail.</p>
      </div>
    )
  }

  if (!trips || trips.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-5xl mb-4">⛳</p>
        <h2 className="text-lg font-bold text-text mb-2">No trips yet</h2>
        <p className="text-text-muted text-sm mb-6 max-w-xs mx-auto">
          Create your first golf trip and invite your group.
        </p>
        <a href="/trips/new"
          className="inline-block bg-brand-600 text-white text-sm font-semibold px-6 py-3 rounded-xl hover:bg-brand-700 transition-colors">
          Create a trip
        </a>
      </div>
    )
  }

  // Segment trips
  const activeSections = {
    live:      trips.filter((t: TripSummary) => t.status === 'live'),
    upcoming:  trips.filter((t: TripSummary) => ['open','groups_ready','ready'].includes(t.status)),
    drafts:    trips.filter((t: TripSummary) => t.status === 'draft'),
  }
  const completed = trips.filter((t: TripSummary) => t.status === 'completed')
  const archived  = trips.filter((t: TripSummary) => t.status === 'archived')

  const activeCount   = activeSections.live.length + activeSections.upcoming.length + activeSections.drafts.length
  const archivedCount = archived.length

  return (
    <div className="space-y-4">
      {/* ── Filter tabs ──────────────────────────────────────────────── */}
      <div className="flex gap-1 p-1 rounded-2xl" style={{ background: '#f2e8d0' }}>
        {([
          { id: 'active' as const,    label: 'Active',    count: activeCount },
          { id: 'completed' as const, label: 'Completed', count: completed.length },
          { id: 'archived' as const,  label: 'Archived',  count: archivedCount },
        ] as const).map(tab => (
          <button key={tab.id} onClick={() => setFilter(tab.id)} style={{
            flex: 1, padding: '8px 10px', borderRadius: 14,
            border: 'none', cursor: 'pointer', transition: 'all 0.15s',
            background: filter === tab.id ? '#ffffff' : 'transparent',
            boxShadow: filter === tab.id ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
            fontFamily: 'var(--font-body)',
            fontSize: 12, fontWeight: filter === tab.id ? 700 : 500,
            color: filter === tab.id ? '#1a1a16' : '#7a7260',
          }}>
            {tab.label}
            {tab.count > 0 && (
              <span style={{
                marginLeft: 5, fontSize: 10,
                color: filter === tab.id ? '#1a4731' : '#a89e88',
              }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Active ───────────────────────────────────────────────────── */}
      {filter === 'active' && (
        <div className="space-y-6">
          <TripGroup label="Live now"  trips={activeSections.live}     indicator />
          <TripGroup label="Upcoming"  trips={activeSections.upcoming} />
          <TripGroup label="Drafts"    trips={activeSections.drafts} />
          {activeCount === 0 && (
            <EmptyState
              icon="📋"
              title="No active trips"
              body="Create a new trip or check your completed and archived trips."
            />
          )}
        </div>
      )}

      {/* ── Completed ────────────────────────────────────────────────── */}
      {filter === 'completed' && (
        <div className="space-y-3">
          {completed.length === 0 ? (
            <EmptyState icon="🏆" title="No completed trips yet" body="Completed trips will appear here." />
          ) : (
            completed.map((trip: TripSummary) => <TripCard key={trip.id} trip={trip} />)
          )}
        </div>
      )}

      {/* ── Archived ─────────────────────────────────────────────────── */}
      {filter === 'archived' && (
        <div className="space-y-3">
          {archived.length === 0 ? (
            <EmptyState
              icon="📁"
              title="No archived trips"
              body="Archive a trip to remove it from your active list while keeping all its data."
            />
          ) : (
            <>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260', marginBottom: 4 }}>
                Archived trips preserve all players, groups, rounds and scores. Open a trip to restore or delete it.
              </p>
              {archived.map((trip: TripSummary) => <TripCard key={trip.id} trip={trip} />)}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function TripGroup({ label, trips, indicator }: { label: string; trips: TripSummary[]; indicator?: boolean }) {
  if (trips.length === 0) return null
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3 flex items-center gap-1.5">
        {indicator && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
        {label}
      </h2>
      <div className="space-y-3">
        {trips.map((trip: TripSummary) => <TripCard key={trip.id} trip={trip} />)}
      </div>
    </section>
  )
}

function EmptyState({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="text-center py-10">
      <p style={{ fontSize: 36, marginBottom: 10 }}>{icon}</p>
      <p style={{ fontFamily: 'var(--font-body)', fontWeight: 600, color: '#1a1a16', marginBottom: 4 }}>{title}</p>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260', maxWidth: 280, margin: '0 auto' }}>{body}</p>
    </div>
  )
}
