import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SideGamesClient from './SideGamesClient'

export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ tripId: string }> }

export default async function SideGamesPage({ params }: Props) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Side Games is explicitly round-specific — the active round if one is
  // in progress, otherwise the most recently relevant one (same "focus
  // round" reasoning already used elsewhere, e.g. PlayerHomeCard), never
  // a merged view across rounds.
  const { data: rounds } = await supabase
    .from('rounds')
    .select('id, name, course_name, status, play_date')
    .eq('trip_id', tripId)
    .order('play_date', { ascending: false })

  const activeRound = rounds?.find(r => r.status === 'active')
  const round = activeRound ?? rounds?.find(r => r.status === 'completed') ?? rounds?.[0] ?? null

  return <SideGamesClient tripId={tripId} round={round} />
}

