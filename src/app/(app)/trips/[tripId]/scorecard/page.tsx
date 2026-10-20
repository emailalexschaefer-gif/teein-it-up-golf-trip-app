import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { pickCurrentRound } from '@/lib/scoring/currentRound'

// 18 Oct field test -- the bottom nav's "Scorecard" target.
//
// The trip layout works out the active round ONCE, when the layout is first
// rendered, and Next.js keeps a layout mounted while you move between pages
// under it. So a nav link built from that value can point at a round that
// has since finished (or at the lobby when a round started after the layout
// loaded). This page resolves the CURRENT round at the moment the player taps
// Scorecard, then sends them to that round's scoring screen (which resumes at
// the last scored hole). Nothing is cached: force-dynamic.
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface Props { params: Promise<{ tripId: string }> }

export default async function ScorecardRedirect({ params }: Props) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = supabase
  const res = await db
    .from('rounds')
    .select('id, status, play_date, tee_time')
    .eq('trip_id', tripId)
    .eq('status', 'active')
  const current = pickCurrentRound((res?.data ?? []) as { id: string; status: string; play_date: string | null; tee_time: string | null }[])

  // No active round: same destination the nav always used in that case.
  redirect(current ? `/trips/${tripId}/rounds/${current.id}` : `/trips/${tripId}`)
}
