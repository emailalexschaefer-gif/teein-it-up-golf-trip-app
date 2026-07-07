import type { Metadata } from 'next'
import TripList from '@/components/trips/TripList'
import PendingJoinHandler from '@/components/trips/PendingJoinHandler'
import JoinByCode from '@/components/trips/JoinByCode'

export const metadata: Metadata = { title: 'My Trips' }

export default function DashboardPage() {
  return (
    <div>
      {/* Auto-joins trip if pendingInviteCode is in sessionStorage */}
      <PendingJoinHandler />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text">My Trips</h1>
          <p className="text-text-muted text-sm mt-0.5">Your golf trips, all in one place.</p>
        </div>
        <a
          href="/trips/new"
          className="bg-brand-600 text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-brand-700 transition-colors"
        >
          + New trip
        </a>
      </div>

      <div className="space-y-4">
        <TripList />
        <JoinByCode />
      </div>
    </div>
  )
}
