import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import ScoreSessionShell from './ScoreSessionShell'

interface Props { params: Promise<{ tripId: string; roundId: string }> }

export default async function RoundScorePage({ params }: Props) {
  const { tripId, roundId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Use admin client to bypass RLS — ensures the page always loads
  // even if the user's RLS session hasn't fully propagated after round start.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  // Verify the user belongs to this trip
  const memberCheck = await admin
    .from('trip_members')
    .select('role')
    .eq('trip_id', tripId)
    .eq('profile_id', user.id)
    .maybeSingle()

  if (!memberCheck.data) {
    redirect(`/dashboard`)
  }

  // Fetch round details
  const roundRes = await admin
    .from('rounds')
    .select('id, name, status, holes, scoring_format, course_name, tee_time, play_date, trip_id')
    .eq('id', roundId)
    .eq('trip_id', tripId)
    .single()

  if (roundRes.error || !roundRes.data) {
    redirect(`/trips/${tripId}`)
  }

  const round = roundRes.data

  // If round is not yet active, redirect back to the trip (they'll see the Rounds tab)
  if (round.status === 'upcoming') {
    redirect(`/trips/${tripId}`)
  }

  // Fetch the caller's scorecard
  const scorecardRes = await admin
    .from('scorecards')
    .select('id, playing_handicap, status')
    .eq('round_id', roundId)
    .eq('player_id', user.id)
    .maybeSingle()

  // Fetch all scorecards with player info
  const allCardsRes = await admin
    .from('scorecards')
    .select(`
      id, player_id, playing_handicap, status,
      profiles:player_id ( id, full_name, avatar_url )
    `)
    .eq('round_id', roundId)
    .neq('status', 'withdrawn')

  // Fetch trip info
  const tripRes = await admin
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
