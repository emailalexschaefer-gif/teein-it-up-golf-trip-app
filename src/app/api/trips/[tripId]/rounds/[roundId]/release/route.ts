/**
 * POST /api/trips/[tripId]/rounds/[roundId]/release
 *
 * "Confirm & Release to Players" — Package 2. Publishes the current
 * group/handicap/tee-time/start-format configuration to players by
 * setting rounds.setup_released = true. Deliberately does NOT touch
 * rounds.status — that still only ever changes via the existing
 * /start route, kept completely separate so "released" and "live" stay
 * two genuinely distinct, independently-representable states.
 *
 * This endpoint does not itself write groups/handicaps/tee times/start
 * type — those are already saved incrementally as the organiser edits
 * them in BeginRoundModal (each field its own existing, already-working
 * PATCH/upsert endpoint). This is purely the readiness gate plus the
 * flag flip; no new "save the whole form" mechanism is introduced.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePlayingHandicap } from '@/lib/scoring/defaultHoles'

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

export async function POST(_req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  type AdminClient = ReturnType<typeof createAdminClient>
  const admin: AdminClient = createAdminClient()

  const memberCheck = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberCheck.data || memberCheck.data.role !== 'organiser') {
    return NextResponse.json({ error: 'Organiser access required.' }, { status: 403 })
  }

  const roundRes = await admin.from('rounds').select('id, status, start_type').eq('id', roundId).eq('trip_id', tripId).maybeSingle()
  if (!roundRes.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })
  if (roundRes.data.status === 'completed') {
    return NextResponse.json({ error: 'This round has already been completed.' }, { status: 409 })
  }

  // Every player expected to participate — trip_members with role
  // 'player' plus the organiser if organiser_is_playing, matching the
  // exact canonical player-count formula already used consistently
  // elsewhere in this app (dashboard counts, Players Joined heading).
  const [tripRes, membersRes, groupsRes, startingHolesRes] = await Promise.all([
    admin.from('trips').select('organiser_is_playing').eq('id', tripId).maybeSingle(),
    admin.from('trip_members').select('profile_id, role, group_id, playing_handicap, profiles:profile_id(handicap)').eq('trip_id', tripId),
    admin.from('trip_groups').select('id, tee_time').eq('trip_id', tripId),
    admin.from('round_group_starting_holes').select('group_id').eq('round_id', roundId),
  ])

  const organiserIsPlaying = tripRes.data?.organiser_is_playing ?? false
  const participatingMembers = ((membersRes.data ?? []) as unknown as { profile_id: string; role: string; group_id: string | null; playing_handicap: number | null; profiles: { handicap: number | null } | null }[])
    .filter(m => m.role === 'player' || (m.role === 'organiser' && organiserIsPlaying))
  const isShotgun = roundRes.data.start_type === 'shotgun'
  const startingHoleGroupIds = new Set((startingHolesRes.data ?? []).map((r: { group_id: string }) => r.group_id))

  const readiness = {
    playersAssigned: participatingMembers.filter(m => m.group_id != null).length,
    playersTotal: participatingMembers.length,
    groupsComplete: 0, // computed below
    groupsTotal: (groupsRes.data ?? []).length,
    handicapsConfirmed: participatingMembers.filter(m => resolvePlayingHandicap(m.playing_handicap, m.profiles?.handicap ?? null) !== null).length,
    teeTimesSet: (groupsRes.data ?? []).filter((g: { tee_time: string | null }) => g.tee_time).length,
    startFormatSelected: !!roundRes.data.start_type,
    // Only meaningful for shotgun — a standard round genuinely has
    // nothing to assign here, so it's vacuously satisfied rather than
    // blocking release on data that was never required.
    startingHolesComplete: !isShotgun || (groupsRes.data ?? []).every((g: { id: string }) => startingHoleGroupIds.has(g.id)),
  }
  const groupIdsWithPlayers = new Set(participatingMembers.filter(m => m.group_id).map(m => m.group_id))
  readiness.groupsComplete = (groupsRes.data ?? []).filter((g: { id: string }) => groupIdsWithPlayers.has(g.id)).length

  const isReady = readiness.playersTotal > 0
    && readiness.playersAssigned === readiness.playersTotal
    && readiness.groupsTotal > 0
    && readiness.groupsComplete === readiness.groupsTotal
    && readiness.handicapsConfirmed === readiness.playersTotal
    && readiness.teeTimesSet === readiness.groupsTotal
    && readiness.startFormatSelected
    && readiness.startingHolesComplete

  if (!isReady) {
    // Do not silently insert fake/default values to satisfy readiness —
    // report exactly what's missing instead, matching the brief's own
    // explicit instruction.
    return NextResponse.json({ error: 'Round setup is not yet complete.', readiness }, { status: 400 })
  }

  const { error } = await admin.from('rounds').update({ setup_released: true }).eq('id', roundId)
  if (error) {
    console.error('[release] update failed', { roundId, error: error.message })
    return NextResponse.json({ error: 'Could not release this round. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, readiness })
}
