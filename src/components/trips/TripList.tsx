'use client'

import { useMyTrips } from '@/lib/queries/trips'
import TripCard from './TripCard'
import EmptyTrips from './EmptyTrips'

export default function TripList() {
  const { data: trips, isLoading, error } = useMyTrips()

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-2xl bg-surface-subtle animate-pulse" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-red-50 border border-red-100 p-6 text-center">
        <p className="text-sm text-red-600">
          Couldn&apos;t load your trips. Check your connection and try again.
        </p>
      </div>
    )
  }

  if (!trips || trips.length === 0) {
    return <EmptyTrips />
  }

  // Group: Live first, then upcoming, then past
  const live      = trips.filter((t) => t.status === 'live')
  const active    = trips.filter((t) => ['open', 'ready'].includes(t.status))
  const draft     = trips.filter((t) => t.status === 'draft')
  const completed = trips.filter((t) => t.status === 'completed')

  return (
    <div className="space-y-6">
      {live.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-status-live mb-3 flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-status-live animate-pulse" />
            Live now
          </h2>
          <div className="space-y-3">
            {live.map((trip) => <TripCard key={trip.id} trip={trip} />)}
          </div>
        </section>
      )}

      {active.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">
            Upcoming
          </h2>
          <div className="space-y-3">
            {active.map((trip) => <TripCard key={trip.id} trip={trip} />)}
          </div>
        </section>
      )}

      {draft.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">
            Drafts
          </h2>
          <div className="space-y-3">
            {draft.map((trip) => <TripCard key={trip.id} trip={trip} />)}
          </div>
        </section>
      )}

      {completed.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">
            Completed
          </h2>
          <div className="space-y-3">
            {completed.map((trip) => <TripCard key={trip.id} trip={trip} />)}
          </div>
        </section>
      )}
    </div>
  )
}
