import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import ScoreSessionShell from './ScoreSessionShell'
import SelfMarkerScoreShell from './SelfMarkerScoreShell'

interface Props { params: Promise<{ tripId: string; roundId: string }> }

// Set SCORING_DEBUG=1 in the environment to get structured diagnostic logs
// for this page's group/scorecard resolution. Off by default — do not leave
// this on in production; it logs user/trip/round ids.
const DEBUG = process.env.SCORING_DEBUG === '1'

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
    .select('id, role, group_id')
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
    .select('id, name, status, holes, scoring_format, course_name, tee_time, play_date, trip_id, score_capture_mode')
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

  // ── Fetch every scorecard for the round ─────────────────────────────────────
  // IMPORTANT: `scorecards.player_id` references `profiles(id)`, NOT
  // `trip_members`. There is no foreign key from scorecards to trip_members,
  // so PostgREST/Supabase CANNOT embed `trip_members` on this query — an
  // earlier version of this page tried `trip_members!inner(group_id)` here,
  // which silently failed (no relationship to embed) and, because the error
  // was never checked, was swallowed into an empty array. That was the exact
  // cause of "No scorecard found for this group": every scorecard on every
  // round was silently discarded before the group filter even ran.
  //
  // Fix: fetch scorecards on their own (profiles and score_entries DO have
  // real foreign keys to scorecards, so those embeds are valid), then fetch
  // trip_members separately and merge group membership in application code.
  const allCardsRes = await admin
    .from('scorecards')
    .select(`
      id, player_id, playing_handicap, status,
      profiles:player_id ( id, full_name, avatar_url ),
      score_entries ( hole_id, gross_score, stableford_pts, is_no_return, capture_role, entered_by )
    `)
    .eq('round_id', roundId)
    .neq('status', 'withdrawn')

  if (allCardsRes.error) {
    // This is a real query failure, not "no scorecards" — surface it loudly
    // rather than silently treating it as an empty group.
    console.error('[round page] scorecards query failed', {
      roundId, tripId, userId: user.id, error: allCardsRes.error,
    })
  }

  const membersRes = await admin
    .from('trip_members')
    .select('profile_id, group_id')
    .eq('trip_id', tripId)

  if (membersRes.error) {
    console.error('[round page] trip_members query failed', { tripId, error: membersRes.error })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groupIdByProfile = new Map<string, string | null>(
    (membersRes.data ?? []).map((m: any) => [m.profile_id, m.group_id])
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allCards = (allCardsRes.data ?? []).map((c: any) => ({
    ...c,
    groupId: groupIdByProfile.get(c.player_id) ?? null,
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const myCard = allCards.find((c: any) => c.player_id === user.id)
  const myGroupId = myCard?.groupId ?? memberCheck.data.group_id ?? null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sortMine = (cards: any[]) =>
    [...cards].sort((a, b) => (a.player_id === user.id ? -1 : b.player_id === user.id ? 1 : 0))

  if (DEBUG) {
    console.log('[round page] diagnostic', {
      user_id: user.id,
      trip_id: tripId,
      round_id: roundId,
      trip_member_id: memberCheck.data.id,
      trip_role: memberCheck.data.role,
      resolved_group_id: myGroupId,
      available_group_ids: [...new Set(allCards.map((c: { groupId: string | null }) => c.groupId))],
      scorecard_count_before_filter: allCards.length,
    })
  }

  const tripNameRes = await admin.from('trips').select('name').eq('id', tripId).single()
  const tripName = tripNameRes.data?.name ?? 'Trip'

  // ── Self + marker mode (the new Sprint 5B default) ──────────────────────────
  // group_scorer is the only mode that still uses the old "one scorer for
  // the whole group" flow — retained, not deleted, for charity days /
  // corporate events per the brief. Everything else (self_and_marker, the
  // default, and individual) uses the new per-player self+marker model.
  if (round.score_capture_mode !== 'group_scorer') {
    const myCard = allCards.find((c: { player_id: string }) => c.player_id === user.id) ?? null

    // 'individual' mode genuinely has no marker concept — skip the
    // round_markers lookup entirely rather than fetching it and then
    // discarding it, so there's no path by which a stray row could leak
    // through into the UI for this mode.
    const usesMarkers = round.score_capture_mode === 'self_and_marker'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let markedByProfile: any = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let markedCard: any = null

    if (usesMarkers) {
      const markersRes = await admin
        .from('round_markers')
        .select('player_id, marker_player_id')
        .eq('round_id', roundId)

      if (markersRes.error) {
        console.error('[round page] round_markers query failed', { roundId, error: markersRes.error })
      }
      const markerRows: Array<{ player_id: string; marker_player_id: string }> = markersRes.data ?? []

      // Who marks me? (a row where I'm the one being marked)
      const markedByRow = markerRows.find(r => r.player_id === user.id)
      // Who do I mark? (a row where I'm the marker)
      const iMarkRow = markerRows.find(r => r.marker_player_id === user.id)

      markedByProfile = markedByRow
        ? allCards.find((c: { player_id: string }) => c.player_id === markedByRow.marker_player_id)?.profiles ?? null
        : null

      markedCard = iMarkRow
        ? allCards.find((c: { player_id: string }) => c.player_id === iMarkRow.player_id) ?? null
        : null

      if (DEBUG) {
        console.log('[round page] diagnostic (self+marker)', {
          user_id: user.id, round_id: roundId,
          my_scorecard_found: !!myCard,
          marked_by: markedByRow?.marker_player_id ?? null,
          i_mark: iMarkRow?.player_id ?? null,
        })
      }
    }

    // A genuine data problem here means: this player has a trip membership
    // and a group, but no scorecard exists for them in this round at all —
    // the same class of issue Issue 1 covered, just for this newer model.
    const dataProblem = !myCard

    return (
      <SelfMarkerScoreShell
        tripId={tripId}
        tripName={tripName}
        round={round}
        myScorecard={myCard}
        markedScorecard={markedCard}
        markedByName={markedByProfile?.full_name ?? null}
        isOrganiser={isOrganiser}
        currentUserId={user.id}
        dataProblem={dataProblem}
      />
    )
  }

  // ── group_scorer mode (legacy — organiser-selected only) ─────────────────────
  // Server-enforced, not just hidden in the UI — /api/scores independently
  // re-derives and checks this via same_playing_group() before writing
  // anything, so this filtering is a UX convenience, not the security layer.
  if (!isOrganiser) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const groupScorecards = sortMine(myGroupId
      ? allCards.filter((c: any) => c.groupId === myGroupId)
      : allCards.filter((c: any) => c.player_id === user.id) // solo fallback: no group assigned
    )

    if (DEBUG) {
      console.log('[round page] diagnostic (player)', { scorecard_count_after_filter: groupScorecards.length })
    }

    const tripRes = await admin.from('trips').select('name').eq('id', tripId).single()

    // Only a genuine data problem should ever reach this — a real query
    // failure is logged above, and normal empty (no group assigned yet) is
    // handled by the solo fallback. If we get here with zero cards, the
    // group truly has none.
    const dataProblem = groupScorecards.length === 0

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
        dataProblem={dataProblem}
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
    scorecards: sortMine(allCards.filter((c: any) => c.groupId === g.id)),
  }))
  // NOTE: unlike the player path, organisers keep EVERY group here — even an
  // empty one — because an empty group for an organiser is exactly the
  // "scorecards weren't created correctly" case they need to see and act on,
  // not a group to silently hide from the switcher.

  // A playing organiser defaults to their own group. A non-playing organiser
  // defaults to the first available group (there's no "own card" to anchor
  // to, per organiser_is_playing = false).
  const defaultGroupIdx = Math.max(0, allGroups.findIndex(g =>
    myGroupId ? g.groupId === myGroupId : g.scorecards.some(c => c.player_id === user.id)
  ))

  const groupScorecards = allGroups[defaultGroupIdx]?.scorecards ?? []

  if (DEBUG) {
    console.log('[round page] diagnostic (organiser)', {
      available_group_ids: allGroups.map(g => g.groupId),
      default_group_idx: defaultGroupIdx,
      scorecard_count_after_filter: groupScorecards.length,
    })
  }

  const dataProblem = allCards.length === 0 || groupScorecards.length === 0

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
      dataProblem={dataProblem}
    />
  )
}
