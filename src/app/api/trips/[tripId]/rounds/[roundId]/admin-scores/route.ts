/**
 * GET /api/trips/[tripId]/rounds/[roundId]/admin-scores
 *
 * Priority 4 — a dedicated, organiser-only read for the Admin Score
 * Override UI specifically. Deliberately a separate endpoint from the
 * general-purpose scorecards route (used by the live scoring shells) —
 * this one shapes the response around the exact Round -> Group ->
 * Player -> Scorecard -> hole drill-down the UI needs (hole numbers,
 * not just hole_ids; each self-capture entry's own id, needed to call
 * the override endpoint; admin_overridden surfaced explicitly), rather
 * than repurposing or risking the scoring shells' own data contract.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  type AdminClient = ReturnType<typeof createAdminClient>
  const admin: AdminClient = createAdminClient()

  const membership = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!membership.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })
  if (membership.data.role !== 'organiser') {
    return NextResponse.json({ error: 'Only the organiser can access score overrides.' }, { status: 403 })
  }

  const roundCheck = await admin.from('rounds').select('id').eq('id', roundId).eq('trip_id', tripId).maybeSingle()
  if (!roundCheck.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })

  const [holesRes, scorecardsRes] = await Promise.all([
    admin.from('holes').select('id, hole_number, par').eq('round_id', roundId).order('hole_number', { ascending: true }),
    admin.from('scorecards')
      .select('id, player_id, profiles:player_id ( full_name ), trip_members!inner ( group_id, trip_groups:group_id ( name ) ), score_entries ( id, hole_id, gross_score, is_no_return, stableford_pts, capture_role, admin_overridden )')
      .eq('round_id', roundId).neq('status', 'withdrawn'),
  ])

  type ScorecardRow = {
    id: string; player_id: string
    profiles: { full_name: string } | null
    trip_members: { group_id: string | null; trip_groups: { name: string } | null } | null
    score_entries: { id: string; hole_id: string; gross_score: number | null; is_no_return: boolean; stableford_pts: number | null; capture_role: string; admin_overridden: boolean }[]
  }

  const players = ((scorecardsRes.data ?? []) as unknown as ScorecardRow[]).map(sc => ({
    scorecardId: sc.id,
    playerId: sc.player_id,
    playerName: sc.profiles?.full_name ?? 'Player',
    groupId: sc.trip_members?.group_id ?? null,
    groupName: sc.trip_members?.trip_groups?.name ?? 'Ungrouped',
    holes: (holesRes.data ?? []).map((h: { id: string; hole_number: number; par: number }) => {
      const entry = sc.score_entries.find(e => e.hole_id === h.id && e.capture_role === 'self')
      return {
        holeNumber: h.hole_number, par: h.par,
        grossScore: entry?.gross_score ?? null, isNoReturn: entry?.is_no_return ?? false,
        stablefordPts: entry?.stableford_pts ?? null, adminOverridden: entry?.admin_overridden ?? false,
      }
    }),
  }))

  // Grouped by group for the drill-down UI's first level.
  const groupsMap = new Map<string, { groupId: string | null; groupName: string; players: typeof players }>()
  for (const p of players) {
    const key = p.groupId ?? 'ungrouped'
    if (!groupsMap.has(key)) groupsMap.set(key, { groupId: p.groupId, groupName: p.groupName, players: [] })
    groupsMap.get(key)!.players.push(p)
  }

  return NextResponse.json({ groups: Array.from(groupsMap.values()) })
}
