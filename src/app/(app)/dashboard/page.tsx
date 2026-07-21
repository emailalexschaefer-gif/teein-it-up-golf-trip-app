import type { Metadata } from 'next'
import { Suspense } from 'react'
import TripList from '@/components/trips/TripList'
import PendingJoinHandler from '@/components/trips/PendingJoinHandler'
import DashboardHero from '@/components/trips/DashboardHero'
import JoinByCode from '@/components/trips/JoinByCode'

export const metadata: Metadata = { title: 'My Trips · Teein\' It Up' }

export default function DashboardPage() {
  return (
    <div className="space-y-5">
      <Suspense fallback={null}><PendingJoinHandler /></Suspense>

      {/* Premium hero */}
      <DashboardHero />

      {/* Join a trip — secondary, reduced visual weight */}
      <JoinByCode />

      {/* Trip list */}
      <TripList />
    </div>
  )
}
