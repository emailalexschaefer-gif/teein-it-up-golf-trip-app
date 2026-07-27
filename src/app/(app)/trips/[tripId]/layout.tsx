import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { TripBottomNav, DesktopTripNav } from '@/components/layout/TripBottomNav'

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

  return (
    <div style={{ minHeight: '100vh' }}>
      <DesktopTripNav tripId={tripId} isOrganiser={isOrganiser} />
      {children}
      <TripBottomNav tripId={tripId} isOrganiser={isOrganiser} />
    </div>
  )
}
