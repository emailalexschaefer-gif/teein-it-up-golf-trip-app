import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { TripBottomNav, DesktopTripNav } from '@/components/layout/TripBottomNav'
import RoundStartBanner from '@/components/layout/RoundStartBanner'

// Never cache — organiser status must always reflect the live membership
// table, and this determines which nav items render.
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface Props { params: Promise<{ tripId: string }>; children: React.ReactNode }

export default async function TripScopedLayout({ params, children }: Props) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Same membership check pattern already used in page.tsx — determines
  // isOrganiser for nav visibility only. Does not gate access to any route;
  // individual pages still do their own permission checks.
  const { data: membership } = await supabase
    .from('trip_members').select('role')
    .eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()

  const isOrganiser = membership?.role === 'organiser'

  // The active round, if any — used to make "Scorecard" in the bottom nav
  // jump straight into live scoring, and to detect a just-started round for
  // the notification banner. One lightweight query, reused by both.
  const { data: activeRound } = await supabase
    .from('rounds').select('id, name')
    .eq('trip_id', tripId).eq('status', 'active')
    .maybeSingle()

  return (
    <div style={{ minHeight: '100vh' }}>
      <DesktopTripNav tripId={tripId} isOrganiser={isOrganiser} activeRoundId={activeRound?.id ?? null} />
      {activeRound && (
        <RoundStartBanner tripId={tripId} roundId={activeRound.id} roundName={activeRound.name} />
      )}
      {children}
      <TripBottomNav tripId={tripId} isOrganiser={isOrganiser} activeRoundId={activeRound?.id ?? null} />
    </div>
  )
}
