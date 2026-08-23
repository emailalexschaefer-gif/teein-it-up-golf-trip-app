import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { TripBottomNav, DesktopTripNav } from '@/components/layout/TripBottomNav'
import RoundStartBanner from '@/components/layout/RoundStartBanner'

// Never cache — organiser status must always reflect the live membership
// table, and this determines which nav items render.
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface Props { params: Promise<{ tripId: string }>; children: React.ReactNode }

// Same fix as the root (app)/layout.tsx: a hard timeout so a slow/hanging
// query can never block this layout (and the bottom nav it renders,
// which is the only way to navigate away from a stuck page) from
// rendering at all.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

export default async function TripScopedLayout({ params, children }: Props) {
  const { tripId } = await params
  const supabase = await createClient()
  const userResult = await withTimeout(supabase.auth.getUser(), 4000).catch(() => null)
  const user = userResult?.data?.user ?? null
  if (!user) redirect('/login')

  // Same membership check pattern already used in page.tsx — determines
  // isOrganiser for nav visibility only. Does not gate access to any route;
  // individual pages still do their own permission checks.
  const membershipResult = await withTimeout(
    supabase.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle(),
    4000,
  ).catch(() => null)
  const membership = membershipResult?.data ?? null

  const isOrganiser = membership?.role === 'organiser'

  // The active round, if any — used to make "Scorecard" in the bottom nav
  // jump straight into live scoring, and to detect a just-started round for
  // the notification banner. One lightweight query, reused by both.
  //
  // Bug 2 (field-test corrective) — root cause traced to exactly this
  // query. This runs in the trip layout, meaning it re-executes on
  // EVERY navigation within the trip, and previously had a 4-second
  // timeout with a fully silent failure (.catch(() => null)) — no
  // error shown anywhere, just activeRound quietly becoming null,
  // which sends the Scorecard nav link's fallback straight to the
  // Lobby (`scorecardHref = activeRoundId ? .../rounds/${id} : base`
  // in TripBottomNav.tsx). On real course connectivity (the exact
  // condition field testing exposed and a typical dev machine would
  // never hit), a 4-second timeout is genuinely tight for a database
  // round-trip over a weak connection — increased to 10 seconds, a
  // meaningfully more forgiving margin for a real-world mobile
  // network, while still bounded (never hangs the page indefinitely).
  const activeRoundResult = await withTimeout(
    supabase.from('rounds').select('id, name').eq('trip_id', tripId).eq('status', 'active').maybeSingle(),
    10000,
  ).catch(() => null)
  const activeRound = activeRoundResult?.data ?? null

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
