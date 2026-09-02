import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import ScoreSessionShell from './ScoreSessionShell'
import SelfMarkerScoreShell from './SelfMarkerScoreShell'
import PaperScorecardStatus from './PaperScorecardStatus'
import { detectSharedDeviceGroup, resolveMarkedPlayerId } from '@/lib/scoring/sharedDeviceScoring'

// Same reasoning as the trip detail page — never serve a cached render here.
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface Props { params: Promise<{ tripId: string; roundId: string }> }

// Set SCORING_DEBUG=1 in the environment to get structured diagnostic logs
// for this page's group/scorecard resolution. Off by default — do not leave
// this on in production; it logs user/trip/round ids.
const DEBUG = process.env.SCORING_DEBUG === '1'

// ── Narrow row types matching exactly the columns each query below selects ──
// The admin client itself stays `any` (documented TEMPORARY MVP BACKSTOP in
// next.config.ts — a project-wide, deliberate boundary, not something this
// pass touches) but every value read OUT of a query result is typed from
// here on, instead of re-typing (or mistyping) `any` at each call site.

interface TripMemberRow {
  profile_id: string
  group_id: string | null
}

interface ScoreEntryRow {
  hole_id: string
  gross_score: number
  stableford_pts: number
  is_no_return: boolean
  capture_role: 'self' | 'marker'
  entered_by: string
}

interface ScorecardProfile {
  id: string
  full_name: string
  avatar_url: string | null
}

interface ScorecardRow {
  id: string
  player_id: string
  playing_handicap: number
  status: string
  submitted_at: string | null
  profiles: ScorecardProfile | null
  score_entries: ScoreEntryRow[]
}

interface ScorecardWithGroup extends ScorecardRow {
  groupId: string | null
}

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
    .select('id, playing_handicap, status, scoring_method, score_entries(stableford_pts, capture_role)')
    .eq('round_id', roundId)
    .eq('player_id', user.id)
    .maybeSingle()

  // Add-on 1 — Shared-Device Scoring detection. Re-derived here, server-
  // side, from the caller's actual group's scorecards — never trusted
  // from the client. Runs once, before either the paper intercept or
  // the self_and_marker branch below, so both the digital player (who
  // needs the new shared-device shell) and the paper player (who needs
  // different copy on their own status screen, per item 7) are covered
  // by a single detection, not two independently-maintained checks.
  let sharedDeviceDetection: ReturnType<typeof detectSharedDeviceGroup> = { isSharedDevice: false, digitalPlayerId: null, paperPlayerId: null }
  let sharedDevicePartnerName: string | null = null
  if (memberCheck.data.group_id) {
    const groupCardsRes = await admin.from('scorecards').select('player_id, scoring_method, profiles:player_id(full_name)').eq('round_id', roundId).neq('status', 'withdrawn')
    const groupMembersRes = await admin.from('trip_members').select('profile_id').eq('trip_id', tripId).eq('group_id', memberCheck.data.group_id)
    const groupProfileIds = new Set((groupMembersRes.data ?? []).map((m: { profile_id: string }) => m.profile_id))
    const relevantCards = (groupCardsRes.data ?? []).filter((c: { player_id: string }) => groupProfileIds.has(c.player_id))
    sharedDeviceDetection = detectSharedDeviceGroup(
      relevantCards.map((c: { player_id: string; scoring_method: string }) => ({ playerId: c.player_id, scoringMethod: c.scoring_method === 'paper' ? 'paper' : 'digital' }))
    )
    if (sharedDeviceDetection.isSharedDevice) {
      const partnerId = sharedDeviceDetection.digitalPlayerId === user.id ? sharedDeviceDetection.paperPlayerId : sharedDeviceDetection.digitalPlayerId
      const partnerCard = relevantCards.find((c: { player_id: string }) => c.player_id === partnerId) as { profiles?: { full_name?: string } | null } | undefined
      sharedDevicePartnerName = partnerCard?.profiles?.full_name ?? null
    }
  }

  // Offline Player Support — a paper-scorecard player never enters either
  // digital scoring shell at all, regardless of score_capture_mode. This
  // is the single, server-side, centralized intercept point (before any
  // branch below runs), matching item 7's "the app should automatically
  // know from their round-specific scoring method" — no client-side
  // detection, no separate route. Absence of a scorecard row at all
  // (organiser hasn't started the round / genuine data problem) falls
  // through to the existing shells unchanged — this only intercepts a
  // scorecard that explicitly says 'paper'.
  if (scorecardRes.data?.scoring_method === 'paper') {
    const tripRes = await admin.from('trips').select('name').eq('id', tripId).single()
    // Item 12 — "automatically move from waiting to Round Score Entered,
    // no action required from the paper player." The organiser's Enter
    // Paper Scorecard save writes capture_role='self' score_entries
    // exactly like every other official score (see applyHoleOverride) —
    // their presence here is the same signal the rest of the app already
    // treats as "this player has an official result," not a new concept.
    const paperEntries = (scorecardRes.data.score_entries ?? []).filter((e: { capture_role: string }) => e.capture_role === 'self')
    const paperTotal = paperEntries.length > 0
      ? paperEntries.reduce((sum: number, e: { stableford_pts: number }) => sum + (e.stableford_pts ?? 0), 0)
      : null
    return (
      <PaperScorecardStatus
        tripId={tripId} roundId={roundId} tripName={tripRes.data?.name ?? 'Trip'}
        roundName={round.name} paperTotal={paperTotal}
        // Add-on 1, item 7 — Mick's own screen, when he's the paper
        // half of a detected shared-device pairing, gets the explicit
        // "Alex is scoring for you" copy instead of the generic paper
        // waiting message, without changing anything about what data
        // this page fetched or how paperTotal was computed above.
        sharedDeviceScorerName={sharedDeviceDetection.isSharedDevice && sharedDeviceDetection.paperPlayerId === user.id ? sharedDevicePartnerName : null}
      />
    )
  }

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
      id, player_id, playing_handicap, status, submitted_at,
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

  const groupIdByProfile = new Map<string, string | null>(
    ((membersRes.data ?? []) as TripMemberRow[]).map((m) => [m.profile_id, m.group_id])
  )

  const allCards: ScorecardWithGroup[] = ((allCardsRes.data ?? []) as ScorecardRow[]).map((c) => ({
    ...c,
    groupId: groupIdByProfile.get(c.player_id) ?? null,
  }))

  const myCard = allCards.find((c) => c.player_id === user.id)
  const myGroupId = myCard?.groupId ?? memberCheck.data.group_id ?? null

  const sortMine = (cards: ScorecardWithGroup[]) =>
    [...cards].sort((a, b) => (a.player_id === user.id ? -1 : b.player_id === user.id ? 1 : 0))

  if (DEBUG) {
    console.log('[round page] diagnostic', {
      user_id: user.id,
      trip_id: tripId,
      round_id: roundId,
      trip_member_id: memberCheck.data.id,
      trip_role: memberCheck.data.role,
      resolved_group_id: myGroupId,
      available_group_ids: [...new Set(allCards.map((c) => c.groupId))],
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
    const myCard = allCards.find((c) => c.player_id === user.id) ?? null

    // 1 Sep field-test bundle — refactored to call the same shared,
    // tested resolveMarkedPlayerId() that /my-scores/route.ts now uses,
    // instead of this file's own separate inline version of the exact
    // same decision. This is the direct fix for the original P0's real
    // cause: two independent implementations of "who is my marked/
    // shared-device partner" were free to silently drift apart, and did.
    // Behaviour is unchanged — this performs the identical query only
    // when it was already being performed (round_markers is still
    // skipped entirely for a shared-device pair or 'individual' mode,
    // exactly as before), it just delegates the actual decision to the
    // shared function rather than re-implementing it a second time.
    const usesMarkers = round.score_capture_mode === 'self_and_marker'
    const isSharedDeviceForMe = sharedDeviceDetection.isSharedDevice && sharedDeviceDetection.digitalPlayerId === user.id

    let markerRows: Array<{ player_id: string; marker_player_id: string }> = []
    if (usesMarkers && !isSharedDeviceForMe) {
      const markersRes = await admin
        .from('round_markers')
        .select('player_id, marker_player_id')
        .eq('round_id', roundId)
      if (markersRes.error) {
        console.error('[round page] round_markers query failed', { roundId, error: markersRes.error })
      }
      markerRows = markersRes.data ?? []
    }

    const resolution = resolveMarkedPlayerId({
      myUserId: user.id,
      sharedDeviceDetection,
      usesMarkers,
      markerRows: markerRows.map(r => ({ playerId: r.player_id, markerPlayerId: r.marker_player_id })),
    })

    const markedByProfile: ScorecardProfile | null = resolution.markedByPlayerId
      ? allCards.find((c) => c.player_id === resolution.markedByPlayerId)?.profiles ?? null
      : null
    const markedCard: ScorecardWithGroup | null = resolution.markedPlayerId
      ? allCards.find((c) => c.player_id === resolution.markedPlayerId) ?? null
      : null

    if (DEBUG) {
      console.log('[round page] diagnostic (self+marker)', {
        user_id: user.id, round_id: roundId,
        my_scorecard_found: !!myCard,
        marked_by: resolution.markedByPlayerId,
        i_mark: resolution.markedPlayerId,
        is_shared_device: resolution.isSharedDevice,
      })
    }

    // A genuine data problem here means: this player has a trip membership
    // and a group, but no scorecard exists for them in this round at all —
    // the same class of issue Issue 1 covered, just for this newer model.
    const dataProblem = !myCard

    // Offline Player Support, item 9 — Side Games proxy entry needs
    // access to the FULL playing group, not just the digital marker
    // pair (myCard/markedCard). Without this, a paper player (never
    // anyone's round_markers partner, by design — see the markers
    // route's exclusion) would never appear as a "Result for"
    // candidate at all in self_and_marker mode, the app's default —
    // confirmed as a genuine gap by inspection, not assumed. Built
    // from allCards (already fetched above, with groupId already
    // resolved), not a new query — every existing scorecard in the
    // caller's own group, digital or paper, regardless of whether they
    // have a marker relationship with anyone.
    const myGroupIdForRoster = myCard ? groupIdByProfile.get(myCard.player_id) ?? null : null
    const fullGroupRoster = myGroupIdForRoster
      ? allCards.filter(c => c.groupId === myGroupIdForRoster).map(c => ({ id: c.player_id, name: c.profiles?.full_name ?? 'Player' }))
      : []

    return (
      <SelfMarkerScoreShell
        tripId={tripId}
        tripName={tripName}
        round={round}
        myScorecard={myCard}
        markedScorecard={markedCard}
        markedByName={markedByProfile?.full_name ?? null}
        isOrganiser={isOrganiser}
        dataProblem={dataProblem}
        fullGroupRoster={fullGroupRoster}
        // Add-on 1 — corrected architecture. isSharedDeviceScoring only
        // changes: the partner card's heading/label, whether
        // partnerComparison is ever computed (never, in this mode —
        // see this component's own internal changes), and which write
        // path confirmScore uses for the second score. Nothing else
        // about the render tree is conditioned on this flag.
        isSharedDeviceScoring={isSharedDeviceForMe}
      />
    )
  }

  // ── group_scorer mode (legacy — organiser-selected only) ─────────────────────
  // Server-enforced, not just hidden in the UI — /api/scores independently
  // re-derives and checks this via same_playing_group() before writing
  // anything, so this filtering is a UX convenience, not the security layer.
  if (!isOrganiser) {
    const groupScorecards = sortMine(myGroupId
      ? allCards.filter((c) => c.groupId === myGroupId)
      : allCards.filter((c) => c.player_id === user.id) // solo fallback: no group assigned
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

  const allGroups = trip_groups.map((g) => ({
    groupId: g.id,
    groupName: g.name,
    teeTime: g.tee_time,
    scorecards: sortMine(allCards.filter((c) => c.groupId === g.id)),
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
