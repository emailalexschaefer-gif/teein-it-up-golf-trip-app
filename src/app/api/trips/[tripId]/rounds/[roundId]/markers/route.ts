/**
 * GET  /api/trips/[tripId]/rounds/[roundId]/markers
 *   Returns current marker assignments for every playing group in this
 *   round, plus each group's player list (so the organiser UI can render
 *   an editable pairing view without a second round-trip).
 *
 * POST /api/trips/[tripId]/rounds/[roundId]/markers
 *   Organiser-only. Body: { groupId, assignments?: [{playerId, markerPlayerId}] }
 *   - If `assignments` is omitted, auto-generates sensible pairs/circle for
 *     that group's players (generateMarkerAssignments) and saves them.
 *   - If `assignments` is provided, validates and saves the organiser's
 *     edited pairing for that group.
 *   Enforced server-side: only the organiser may call POST (RLS on
 *   round_markers also only allows organiser writes independently of this
 *   check — defense in depth, not the only layer).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateMarkerAssignments } from '@/lib/scoring/markerAssignment'
import { ScoringDomainError } from '@/lib/scoring/errors'
import { z } from 'zod'

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const memberCheck = await admin
    .from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberCheck.data) return NextResponse.json({ error: 'Not a trip member' }, { status: 403 })

  const [groupsRes, membersRes, cardsRes, markersRes] = await Promise.all([
    admin.from('trip_groups').select('id, name, sort_order').eq('trip_id', tripId).order('sort_order', { ascending: true }),
    admin.from('trip_members').select('profile_id, group_id, profiles:profile_id(id, full_name)').eq('trip_id', tripId),
    admin.from('scorecards').select('id, player_id').eq('round_id', roundId).neq('status', 'withdrawn'),
    admin.from('round_markers').select('player_id, marker_player_id').eq('round_id', roundId),
  ])

  const cardPlayerIds = new Set((cardsRes.data ?? []).map((c: { player_id: string }) => c.player_id))
  const groups = (groupsRes.data ?? []).map((g: { id: string; name: string }) => ({
    groupId: g.id,
    groupName: g.name,
    players: (membersRes.data ?? [])
      .filter((m: { group_id: string | null; profile_id: string }) => m.group_id === g.id && cardPlayerIds.has(m.profile_id))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((m: any) => ({ playerId: m.profile_id, fullName: m.profiles?.full_name ?? 'Player' })),
  })).filter((g: { players: unknown[] }) => g.players.length > 0)

  return NextResponse.json({
    groups,
    assignments: markersRes.data ?? [],
  })
}

const AssignmentSchema = z.object({ playerId: z.string().uuid(), markerPlayerId: z.string().uuid() })
const PostSchema = z.object({
  groupId: z.string().uuid(),
  assignments: z.array(AssignmentSchema).optional(),
})

export async function POST(req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const memberCheck = await admin
    .from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberCheck.data || memberCheck.data.role !== 'organiser') {
    return NextResponse.json({ error: 'Only the organiser can set marker assignments.' }, { status: 403 })
  }

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = PostSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 })

  const { groupId } = parsed.data

  const [membersRes, cardsRes] = await Promise.all([
    admin.from('trip_members').select('profile_id').eq('trip_id', tripId).eq('group_id', groupId),
    admin.from('scorecards').select('player_id').eq('round_id', roundId).neq('status', 'withdrawn'),
  ])

  const cardPlayerIds = new Set((cardsRes.data ?? []).map((c: { player_id: string }) => c.player_id))
  const groupPlayerIds: string[] = (membersRes.data ?? [])
    .map((m: { profile_id: string }) => m.profile_id)
    .filter((id: string) => cardPlayerIds.has(id))

  if (groupPlayerIds.length < 2) {
    return NextResponse.json({ error: 'This group needs at least 2 players with scorecards to assign markers.' }, { status: 422 })
  }

  let assignments = parsed.data.assignments
  if (!assignments) {
    try {
      assignments = generateMarkerAssignments(groupPlayerIds)
    } catch (err) {
      if (err instanceof ScoringDomainError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 422 })
      }
      throw err
    }
  } else {
    // Validate an organiser-edited assignment set: every group player covered
    // exactly once, no self-marking, no players outside this group.
    const playerSet = new Set(groupPlayerIds)
    const covered = new Set(assignments.map(a => a.playerId))
    if (covered.size !== groupPlayerIds.length || ![...covered].every(id => playerSet.has(id))) {
      return NextResponse.json({ error: 'Every player in the group must have exactly one marker assignment.' }, { status: 422 })
    }
    for (const a of assignments) {
      if (a.playerId === a.markerPlayerId) {
        return NextResponse.json({ error: 'A player cannot be their own marker.' }, { status: 422 })
      }
      if (!playerSet.has(a.markerPlayerId)) {
        return NextResponse.json({ error: 'A marker must be another member of the same playing group.' }, { status: 422 })
      }
    }
  }

  // Replace this group's assignments for this round (delete-then-insert,
  // scoped to this round + these players, so other groups are untouched).
  const delRes = await admin
    .from('round_markers')
    .delete()
    .eq('round_id', roundId)
    .in('player_id', groupPlayerIds)

  if (delRes.error) {
    console.error('[markers] delete failed', delRes.error)
    return NextResponse.json({ error: 'Could not update marker assignments.' }, { status: 500 })
  }

  const rows = assignments.map(a => ({ round_id: roundId, player_id: a.playerId, marker_player_id: a.markerPlayerId }))
  const insRes = await admin.from('round_markers').insert(rows)

  if (insRes.error) {
    console.error('[markers] insert failed', insRes.error)
    return NextResponse.json({ error: 'Could not save marker assignments.' }, { status: 500 })
  }

  return NextResponse.json({ groupId, assignments }, { status: 200 })
}
