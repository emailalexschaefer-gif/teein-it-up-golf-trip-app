import type { Metadata } from 'next'
import { Suspense } from 'react'
import TripList from '@/components/trips/TripList'
import PendingJoinHandler from '@/components/trips/PendingJoinHandler'
import DashboardHero from '@/components/trips/DashboardHero'
import JoinByCode from '@/components/trips/JoinByCode'

export const metadata: Metadata = { title: "My Events · Teein' It Up" }

export default function DashboardPage() {
  return (
    <div className="space-y-5">
      <Suspense fallback={null}><PendingJoinHandler /></Suspense>

      {/* Premium hero — unchanged, per the explicit instruction to retain
          the existing "Run your golf trip like a pro" / "No admin chaos.
          Just great experiences." messaging exactly as-is. */}
      <DashboardHero />

      {/* Join a trip — secondary, reduced visual weight */}
      <JoinByCode />

      {/* Page heading — "My Events" answers "what golf events am I
          involved in", distinct from the hero's tagline above it. */}
      <h2 style={{
        fontFamily: 'var(--font-display)', color: '#14532d',
        fontSize: 18, fontWeight: 800, margin: '4px 2px 0',
      }}>
        My Events
      </h2>

      {/* Trip list */}
      <TripList />
    </div>
  )
}
