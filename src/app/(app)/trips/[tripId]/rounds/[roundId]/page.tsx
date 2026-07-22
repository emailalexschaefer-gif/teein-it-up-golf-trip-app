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
    .select('role, group_id')
    .eq('trip_id', tripId)
    .eq('profile_id', user.id)
    .maybeSingle()

  if (!memberCheck.data) {
    redirect(`/dashboard`)
  }

  // Trust trip_members.role, the same field the RLS is_trip_organiser()
  // function checks — not trips.organiser_id, which is a separate concept
  // that could in theory drift out of sync with membership role.
  const isOrganiser = memberCheck.data.role === 'organiser'

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

  // Fetch every scorecard for the round, with player info, group membership,
  // and any score_entries already saved (Sprint 5B: hydrate on load so a
  // refresh mid-round doesn't wipe already-entered scores from the UI).
  const allCardsRes = await admin
    .from('scorecards')
    .select(`
      id, player_id, playing_handicap, status,
      profiles:player_id ( id, full_name, avatar_url ),
      trip_members!inner ( group_id ),
      score_entries ( hole_id, gross_score, stableford_pts, is_no_return )
    `)
    .eq('round_id', roundId)
    .neq('status', 'withdrawn')

  const allCards = allCardsRes.data ?? []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const myCard = allCards.find((c: any) => c.player_id === user.id)
  const myGroupId = myCard?.trip_members?.group_id ?? memberCheck.data.group_id ?? null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sortMine = (cards: any[]) =>
    [...cards].sort((a, b) => (a.player_id === user.id ? -1 : b.player_id === user.id ? 1 : 0))

  // ── Ordinary players: locked to their own playing group ────────────────────
  // Server-enforced, not just hidden in the UI — /api/scores independently
  // re-derives and checks this via same_playing_group() before writing
  // anything, so this filtering is a UX convenience, not the security layer.
  if (!isOrganiser) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const groupScorecards = sortMine(myGroupId
      ? allCards.filter((c: any) => c.trip_members?.group_id === myGroupId)
      : allCards.filter((c: any) => c.player_id === user.id) // solo fallback: no group assigned
    )

    const tripRes = await admin.from('trips').select('name').eq('id', tripId).single()

    return (
      <ScoreSessionShell
        tripId={tripId}
        tripName={tripRes.data?.name ?? 'Trip'}
        round={round}
        myScorecard={scorecardRes.data ?? null}
        groupScorecards={groupScorecards}
        allGroups={null}
        isOrganiser={false}
        currentUserId={user.id}
      />
    )
  }

  // ── Organiser: can see and score every playing group ────────────────────────
  const [tripRes, groupsRes] = await Promise.all([
    admin.from('trips').select('name, organiser_is_playing').eq('id', tripId).single(),
    admin.from('trip_groups').select('id, name, tee_time, sort_order').eq('trip_id', tripId).order('sort_order', { ascending: true }),
  ])

  const trip_groups: Array<{ id: string; name: string; tee_time: string | null }> = groupsRes.data ?? []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allGroups = trip_groups.map((g) => ({
    groupId: g.id,
    groupName: g.name,
    teeTime: g.tee_time,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    scorecards: sortMine(allCards.filter((c: any) => c.trip_members?.group_id === g.id)),
  })).filter(g => g.scorecards.length > 0)

  // A playing organiser defaults to their own group. A non-playing organiser
  // defaults to the first available group (there's no "own card" to anchor
  // to, per organiser_is_playing = false).
  const defaultGroupIdx = Math.max(0, allGroups.findIndex(g =>
    myGroupId ? g.groupId === myGroupId : g.scorecards.some(c => c.player_id === user.id)
  ))

  const groupScorecards = allGroups[defaultGroupIdx]?.scorecards ?? []

  return (
    <ScoreSessionShell
      tripId={tripId}
      tripName={tripRes.data?.name ?? 'Trip'}
      round={round}
      myScorecard={scorecardRes.data ?? null}
      groupScorecards={groupScorecards}
      allGroups={allGroups}
      initialGroupIdx={defaultGroupIdx}
      isOrganiser={true}
      currentUserId={user.id}
    />
  )
}
