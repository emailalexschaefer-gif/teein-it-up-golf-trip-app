import type { Metadata } from 'next'
import TripList from '@/components/trips/TripList'
import PendingJoinHandler from '@/components/trips/PendingJoinHandler'
import JoinByCode from '@/components/trips/JoinByCode'

export const metadata: Metadata = { title: 'My Trips' }

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <PendingJoinHandler />

      {/* Demo-style page header */}
      <div className="pt-2">
        <p className="section-label mb-1">Dashboard</p>
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-black text-text tracking-tight">My Trips</h1>
          <a
            href="/trips/new"
            className="bg-brand-600 text-white text-sm font-bold px-5 py-3 rounded-2xl hover:bg-brand-700 transition-colors shadow-card"
          >
            + New Trip
          </a>
        </div>
      </div>

      <TripList />

      <JoinByCode />
    </div>
  )
}
