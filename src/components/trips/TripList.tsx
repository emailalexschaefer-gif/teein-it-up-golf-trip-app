'use client'

import { useMyTrips } from '@/lib/queries/trips'
import TripCard from './TripCard'
import type { TripSummary } from '@/types/app'

export default function TripList() {
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
    // Show the actual error so we can diagnose it in production
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
        <a
          href="/trips/new"
          className="inline-block bg-brand-600 text-white text-sm font-semibold px-6 py-3 rounded-xl hover:bg-brand-700 transition-colors"
        >
          Create a trip
        </a>
      </div>
    )
  }

  const live      = trips.filter((t) => t.status === 'live')
  const upcoming  = trips.filter((t) => ['open', 'ready'].includes(t.status))
  const drafts    = trips.filter((t) => t.status === 'draft')
  const completed = trips.filter((t) => t.status === 'completed')

  return (
    <div className="space-y-6">
      <TripGroup label="Live now"  trips={live}      indicator />
      <TripGroup label="Upcoming"  trips={upcoming} />
      <TripGroup label="Drafts"    trips={drafts} />
      <TripGroup label="Completed" trips={completed} />
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
        {trips.map((trip) => <TripCard key={trip.id} trip={trip} />)}
      </div>
    </section>
  )
}
