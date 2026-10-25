/**
 * POST /api/trips/[tripId]/rounds/[roundId]/leaders-last
 *
 * Organiser-only. Reseeds trip_members.group_id so the current event
 * leader (by cumulative standings through the round before this one)
 * ends up in the group with the latest tee time, and the lowest-ranked
 * player in the earliest — the reverse-grid "Leaders Last" pattern.
 *
 * Deliberately does not create a second grouping system: this writes to
 * the exact same trip_members.group_id column the manual group-
 * assignment UI already uses, via the same kind of update the existing
 * members PATCH route performs. The only new logic is *how* the
 * assignment is computed (seedLeadersLast, a pure function), not *where*
 * it's stored.
 *
 * Existing trip_groups (with their tee_time values) are reused as-is,
 * ordered by tee_time — group index 0 (earliest, per seedLeadersLast)
 * maps onto whichever trip_groups row has the earliest tee_time, and so
 * on. This is what "preserve tee-time slots, change player assignments"
 * actually means in terms of this schema: the trip_groups rows
 * themselves are untouched, only trip_members.group_id changes.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeCumulativeStandings, seedLeadersLast, sortRoundsChronologically, type RoundPlayerResult } from '@/lib/scoring/multiRound'

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }
type AdminClient = ReturnType<typeof createAdminClient>

interface ScorecardRow {
  player_id: string
  score_entries: { stableford_pts: number; capture_role: string }[]
}

async function totalsForRound(admin: AdminClient, roundId: string): Promise<RoundPlayerResult[]> {
  const { data } = await admin
    .from('scorecards')
    .select('player_id, profiles:player_id(full_name), score_entries(stableford_pts, capture_role)')
    .eq('round_id', roundId)
    .neq('status', 'withdrawn')

  return ((data ?? []) as unknown as (ScorecardRow & { profiles: { full_name: string } | null })[]).map(sc => ({
    playerId: sc.player_id,
    playerName: sc.profiles?.full_name ?? 'Player',
    roundPoints: (sc.score_entries ?? [])
      .filter(e => e.capture_role === 'self')
      .reduce((sum, e) => sum + (e.stableford_pts ?? 0), 0),
  }))
}

export async function POST(_req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const admin: AdminClient = createAdminClient()

  // Organiser-only — this reshuffles every player's group for the
  // upcoming round, not a self-scoped action.
  const tripRes = await admin.from('trips').select('organiser_id').eq('id', tripId).maybeSingle()
  if (!tripRes.data) return NextResponse.json({ error: 'Trip not found.' }, { status: 404 })
  if (tripRes.data.organiser_id !== user.id) {
    return NextResponse.json({ error: 'Only the trip organiser can reseed groups.' }, { status: 403 })
  }

  const thisRoundRes = await admin.from('rounds').select('play_date, created_at').eq('id', roundId).eq('trip_id', tripId).maybeSingle()
  if (!thisRoundRes.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })

  // Same stable-ordering fix as leaderboard/route.ts and setup-context/
  // route.ts — created_at collides for rounds created in the same batch
  // INSERT, so .lt('created_at', ...) can silently miss a genuinely-
  // prior round, which here would mean seeding Leaders-Last from the
  // wrong (or no) standings. Sorts every round for this trip (including
  // this one, so its own array position is findable), then takes
  // everything strictly before it that's actually completed.
  const allRoundsForTripRes = await admin
    .from('rounds').select('id, play_date, created_at, status').eq('trip_id', tripId)
  const sortedRoundsForTrip = sortRoundsChronologically((allRoundsForTripRes.data ?? []) as { id: string; play_date: string; created_at: string; status: string }[])
  const thisRoundIdx = sortedRoundsForTrip.findIndex(r => r.id === roundId)
  const priorRoundIds: string[] = thisRoundIdx <= 0
    ? []
    : sortedRoundsForTrip.slice(0, thisRoundIdx).filter(r => r.status === 'completed').map(r => r.id)

  if (priorRoundIds.length === 0) {
    return NextResponse.json({ error: 'No completed rounds yet — nothing to seed from.' }, { status: 400 })
  }

  const allTotals = await Promise.all(priorRoundIds.map(id => totalsForRound(admin, id)))
  const standings = computeCumulativeStandings(allTotals) // best-to-worst, matches seedLeadersLast's expected input

  // Existing groups for this trip, ordered by tee_time — earliest first.
  // Priority 3 — now prefers THIS round's own round_group_tee_times
  // value when one has been set, falling back to trip_groups.tee_time
  // only as a sorting default when the organiser hasn't set a round-
  // specific time yet. This fallback is deliberately safe here in a way
  // it wouldn't be in a user-facing display: Leaders Last only needs
  // SOME sensible ordering to decide who tees off first in the next
  // round, not an authoritative "this is the official time" claim —
  // that claim only ever comes from Begin Round's own editable field,
  // never from this internal sort. Groups with no time at all (neither
  // round-specific nor trip-wide) still sort last.
  const [groupsRes, roundTeeTimesRes] = await Promise.all([
    admin.from('trip_groups').select('id, tee_time').eq('trip_id', tripId),
    admin.from('round_group_tee_times').select('group_id, tee_time').eq('round_id', roundId),
  ])
  const roundTeeTimeByGroup = new Map((roundTeeTimesRes.data ?? []).map((r: { group_id: string; tee_time: string | null }) => [r.group_id, r.tee_time]))
  const groups: { id: string; tee_time: string | null }[] = (groupsRes.data ?? [])
    .map((g: { id: string; tee_time: string | null }) => ({ id: g.id, tee_time: roundTeeTimeByGroup.get(g.id) ?? g.tee_time }))
    .sort((a, b) => {
      if (a.tee_time === null && b.tee_time === null) return 0
      if (a.tee_time === null) return 1
      if (b.tee_time === null) return -1
      return a.tee_time.localeCompare(b.tee_time)
    })

  if (groups.length === 0) {
    return NextResponse.json({ error: 'No playing groups exist yet — create groups before reseeding.' }, { status: 400 })
  }

  // groupSize derived from the existing group count and player count,
  // not invented — matches whatever grouping the organiser already set
  // up (e.g. 4 groups of 4 for 16 players), so seedLeadersLast produces
  // exactly as many chunks as there are real groups to map onto.
  const groupSize = Math.ceil(standings.length / groups.length)
  const assignments = seedLeadersLast(standings, groupSize)

  // Apply: groupIndex 0 -> groups[0] (earliest tee time), etc. If
  // seedLeadersLast somehow produced more chunks than existing groups
  // (shouldn't happen given groupSize above, but guarded rather than
  // assumed), extra players are clamped into the last real group rather
  // than silently dropped.
  const updates = assignments.map(a => ({
    profile_id: a.playerId,
    group_id: groups[Math.min(a.groupIndex, groups.length - 1)].id,
  }))

  const errors: string[] = []
  for (const u of updates) {
    const { error } = await admin
      .from('trip_members')
      .update({ group_id: u.group_id })
      .eq('trip_id', tripId)
      .eq('profile_id', u.profile_id)
    if (error) errors.push(`${u.profile_id}: ${error.message}`)
  }

  if (errors.length > 0) {
    console.error('[leaders-last] some group updates failed', { tripId, roundId, errors })
    return NextResponse.json({ error: 'Some players could not be reseeded. Please check groups and try again.', details: errors }, { status: 500 })
  }

  return NextResponse.json({ ok: true, playersReseeded: updates.length, groupsUsed: groups.length })
}
