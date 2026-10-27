/**
 * GET /api/trips/[tripId]/rounds/[roundId]/arrangements
 *
 * What the organiser released for this round, as players see it in the Event Lobby: the caller's own
 * group, tee time, starting hole and playing handicap, plus every group with its playing partners.
 * Read from the released snapshot (round_arrangements) -- never from live, editable tables -- so a refresh,
 * new device or later profile change cannot alter it. Any member of THIS event may read it; the round must
 * belong to the trip in the URL. Returns { released:false } until the organiser has released the round.
 */
import { loadTripRoundLabels } from '@/lib/trips/roundLabels'
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  const admin = createAdminClient()

  const member = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!member.data) return NextResponse.json({ error: 'Not a member of this event.' }, { status: 403 })

  const roundRes = await admin.from('rounds').select('id, name, status, play_date, course_name, setup_released, release_revision, released_at').eq('id', roundId).eq('trip_id', tripId).maybeSingle()
  // Column/table missing (migration 101 not applied): behave as "nothing released through the new path".
  if (roundRes.error && ['42703', '42P01', 'PGRST205'].includes(roundRes.error.code ?? '')) return NextResponse.json({ available: false, released: false })
  if (!roundRes.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })
  const round = roundRes.data
  const roundLabel = (await loadTripRoundLabels(admin, tripId)).label({ id: round.id, name: round.name })
  if (!round.setup_released) return NextResponse.json({ available: true, released: false })

  const snap = await admin.from('round_arrangements').select('player_id, group_id, group_name, tee_time, starting_hole, playing_handicap').eq('round_id', roundId)
  if (snap.error) return NextResponse.json({ available: false, released: false })
  const rows = (snap.data ?? []) as { player_id: string; group_id: string; group_name: string | null; tee_time: string | null; starting_hole: number | null; playing_handicap: number }[]
  if (rows.length === 0) return NextResponse.json({ available: true, released: false })

  const profiles = await admin.from('profiles').select('id, full_name, avatar_url').in('id', rows.map(r => r.player_id))
  const byId = new Map(((profiles.data ?? []) as { id: string; full_name: string | null; avatar_url: string | null }[]).map(p => [p.id, p]))

  const groupsMap = new Map<string, { id: string; name: string | null; tee_time: string | null; starting_hole: number | null; players: { id: string; name: string; avatar_url: string | null; playing_handicap: number }[] }>()
  for (const r of rows) {
    if (!groupsMap.has(r.group_id)) groupsMap.set(r.group_id, { id: r.group_id, name: r.group_name, tee_time: r.tee_time, starting_hole: r.starting_hole, players: [] })
    groupsMap.get(r.group_id)!.players.push({ id: r.player_id, name: byId.get(r.player_id)?.full_name ?? 'Player', avatar_url: byId.get(r.player_id)?.avatar_url ?? null, playing_handicap: r.playing_handicap })
  }
  const groups = [...groupsMap.values()].sort((a, b) => (a.tee_time && b.tee_time ? a.tee_time.localeCompare(b.tee_time) : a.tee_time ? -1 : b.tee_time ? 1 : 0))
  const mine = rows.find(r => r.player_id === user.id) ?? null

  return NextResponse.json({
    available: true, released: true, viewerId: user.id,
    round: { id: round.id, name: roundLabel, status: round.status, play_date: round.play_date, course_name: round.course_name ?? null, revision: round.release_revision ?? 0, released_at: round.released_at ?? null },
    me: mine ? { group_id: mine.group_id, group_name: mine.group_name, tee_time: mine.tee_time, starting_hole: mine.starting_hole, playing_handicap: mine.playing_handicap } : null,
    groups,
  })
}
