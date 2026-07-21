import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ScoreSessionShell from './ScoreSessionShell'

interface Props { params: Promise<{ tripId: string; roundId: string }> }

export default async function RoundScorePage({ params }: Props) {
  const { tripId, roundId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = supabase

  // Fetch round details
  const roundRes = await db
    .from('rounds')
    .select('id, name, status, holes, scoring_format, course_name, tee_time, play_date, trip_id')
    .eq('id', roundId)
    .eq('trip_id', tripId)
    .single()

  if (roundRes.error || !roundRes.data) {
    redirect(`/trips/${tripId}`)
  }

  const round = roundRes.data
  if (round.status !== 'active') {
    redirect(`/trips/${tripId}`)
  }

  // Fetch the caller's scorecard
  const scorecardRes = await db
    .from('scorecards')
    .select('id, playing_handicap, status')
    .eq('round_id', roundId)
    .eq('player_id', user.id)
    .maybeSingle()

  // Fetch all scorecards with player info (for group display)
  const allCardsRes = await db
    .from('scorecards')
    .select(`
      id, player_id, playing_handicap, status,
      profiles:player_id ( id, full_name, avatar_url )
    `)
    .eq('round_id', roundId)
    .neq('status', 'withdrawn')

  // Fetch trip name
  const tripRes = await db
    .from('trips')
    .select('name, organiser_id')
    .eq('id', tripId)
    .single()

  const isOrganiser = tripRes.data?.organiser_id === user.id

  return (
    <ScoreSessionShell
      tripId={tripId}
      tripName={tripRes.data?.name ?? 'Trip'}
      round={round}
      myScorecard={scorecardRes.data ?? null}
      allScorecards={allCardsRes.data ?? []}
      isOrganiser={isOrganiser}
      currentUserId={user.id}
    />
  )
}
