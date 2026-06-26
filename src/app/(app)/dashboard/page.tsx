import { Suspense } from 'react'
import type { Metadata } from 'next'
import TripList from '@/components/trips/TripList'
import TripListSkeleton from '@/components/trips/TripListSkeleton'

export const metadata: Metadata = {
  title: 'My Trips',
}

export default function DashboardPage() {
  return (
    <div>
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text">My Trips</h1>
          <p className="text-text-muted text-sm mt-0.5">
            Your golf trips, all in one place.
          </p>
        </div>

        {/* New trip CTA — Sprint 2 will wire this to the full wizard */}
        <a
          href="/trips/new"
          className="bg-brand-600 text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-brand-700 transition-colors flex items-center gap-1.5"
        >
          <span className="text-base leading-none">+</span>
          New trip
        </a>
      </div>

      {/* Trip list */}
      <Suspense fallback={<TripListSkeleton />}>
        <TripList />
      </Suspense>
    </div>
  )
}
