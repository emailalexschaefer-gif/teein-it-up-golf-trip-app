import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { TripBottomNav, DesktopTripNav } from '@/components/layout/TripBottomNav'
import RoundStartBanner from '@/components/layout/RoundStartBanner'
import { loadTripLayoutData } from '@/lib/trips/tripLayoutData'

// Never cache — organiser status must always reflect the live membership
// table, and this determines which nav items render.
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface Props { params: Promise<{ tripId: string }>; children: React.ReactNode }

// Release 3A (performance) — the data loading moved to
// lib/trips/tripLayoutData.ts (unit-tested). It keeps the previous behaviour
// exactly: user first (hard 4 s cap, so a hanging query can never block the
// bottom nav — the only way off a stuck page — from rendering), then the
// membership (nav visibility only), practice flag and active round lookups,
// each with its own timeout/fallback — now issued together rather than one
// after another. Bug 2 (field-test corrective) history: the active-round
// query keeps its 10 s cap because a 4 s cap silently dropped the live-round
// link on weak course connectivity.
export default async function TripScopedLayout({ params, children }: Props) {
  const { tripId } = await params
  const supabase = await createClient()
  const { user, isOrganiser, isPractice, activeRound } = await loadTripLayoutData({
    getUser: () => supabase.auth.getUser(),
    // Same membership check pattern already used in page.tsx — determines
    // isOrganiser for nav visibility only. Does not gate access to any route.
    getMembership: (userId) => supabase.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', userId).maybeSingle(),
    // Practice V2 — Practice-specific navigation item set.
    getPractice: () => supabase.from('trips').select('is_practice').eq('id', tripId).maybeSingle(),
    // The active round, for the Scorecard nav link and the round-start banner.
    getActiveRound: () => supabase.from('rounds').select('id, name').eq('trip_id', tripId).eq('status', 'active').maybeSingle(),
  })
  if (!user) redirect('/login')

  return (
    <div style={{ minHeight: '100vh' }}>
      <DesktopTripNav tripId={tripId} isOrganiser={isOrganiser} activeRoundId={activeRound?.id ?? null} isPractice={isPractice} />
      {activeRound && (
        <RoundStartBanner tripId={tripId} roundId={activeRound.id} roundName={activeRound.name} />
      )}
      {children}
      <TripBottomNav tripId={tripId} isOrganiser={isOrganiser} activeRoundId={activeRound?.id ?? null} isPractice={isPractice} />
    </div>
  )
}
