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

  const [holesRes, scorecardsRes, membersRes] = await Promise.all([
    admin.from('holes').select('id, hole_number, par, stroke_index').eq('round_id', roundId).order('hole_number', { ascending: true }),
    // A1 root cause — this scorecards query previously embedded
    // trip_members via an INNER join
    // (trip_members!inner ( group_id, trip_groups:group_id ( name ) )).
    // An inner join silently drops the ENTIRE scorecard row from the
    // result set if that specific join fails to resolve for any
    // reason — which is exactly consistent with "No matching player in
    // this round" for a player who was demonstrably, actively playing
    // (their scorecard genuinely existed and had score_entries — the
    // player simply never made it into the response at all). Postgrest
    // embeds inferring the wrong foreign key relationship, or failing
    // to resolve one cleanly through an indirect scorecards -> round ->
    // trip -> trip_members chain, is the same class of bug already
    // found and fixed elsewhere in this app by replacing a nested embed
    // with a flat, separately-fetched query — the same fix applies
    // here. group/group-name is now resolved via a plain second query
    // (membersRes below), scoped directly by trip_id with no embed at
    // all, then joined in application code via a Map — nothing here
    // can silently drop a scorecard row anymore, regardless of that
    // player's group assignment state.
    admin.from('scorecards')
      .select('id, player_id, playing_handicap, scoring_method, profiles:player_id ( full_name ), score_entries ( id, hole_id, gross_score, is_no_return, stableford_pts, capture_role, admin_overridden )')
      .eq('round_id', roundId).neq('status', 'withdrawn'),
    admin.from('trip_members').select('profile_id, group_id, trip_groups:group_id ( name )').eq('trip_id', tripId),
  ])

  const memberByProfileId = new Map(
    ((membersRes.data ?? []) as unknown as { profile_id: string; group_id: string | null; trip_groups: { name: string } | null }[])
      .map(m => [m.profile_id, m]),
  )

  type ScorecardRow = {
    id: string; player_id: string; playing_handicap: number | null; scoring_method?: string
    profiles: { full_name: string } | null
    score_entries: { id: string; hole_id: string; gross_score: number | null; is_no_return: boolean; stableford_pts: number | null; capture_role: string; admin_overridden: boolean }[]
  }

  const holeCount = (holesRes.data ?? []).length

  const players = ((scorecardsRes.data ?? []) as unknown as ScorecardRow[]).map(sc => {
    const holes = (holesRes.data ?? []).map((h: { id: string; hole_number: number; par: number; stroke_index: number }) => {
      const entry = sc.score_entries.find(e => e.hole_id === h.id && e.capture_role === 'self')
      return {
        holeNumber: h.hole_number, par: h.par, strokeIndex: h.stroke_index,
        grossScore: entry?.gross_score ?? null, isNoReturn: entry?.is_no_return ?? false,
        stablefordPts: entry?.stableford_pts ?? null, adminOverridden: entry?.admin_overridden ?? false,
      }
    })
    const member = memberByProfileId.get(sc.player_id)
    // Offline Player Support, item 17 — My HQ visibility. hasOfficial
    // Score is derived from the same holes array this route already
    // builds (any hole with a genuine gross value or no-return already
    // entered) — not a new concept, just exposing the existing "has
    // this player got an official self-capture score" signal per hole
    // as a single per-player flag for the paper-card outstanding/
    // entered badge.
    const hasOfficialScore = holes.some(h => h.grossScore !== null || h.isNoReturn)
    return {
      scorecardId: sc.id,
      playerId: sc.player_id,
      playerName: sc.profiles?.full_name ?? 'Player',
      playingHandicap: sc.playing_handicap,
      holesInRound: holeCount,
      groupId: member?.group_id ?? null,
      groupName: member?.trip_groups?.name ?? 'Ungrouped',
      scoringMethod: sc.scoring_method === 'paper' ? 'paper' as const : 'digital' as const,
      hasOfficialScore,
      // Round total — sum of currently-recorded points, the same
      // baseline the confirmation preview's "before" figure uses. Only
      // ever a read/display value here; the actual authoritative total
      // is whatever score_entries/the existing triggers already
      // compute, this is just surfacing it for this UI.
      roundTotal: holes.reduce((sum, h) => sum + (h.stablefordPts ?? 0), 0),
      holes,
    }
  })

  // Grouped by group for the drill-down UI's first level.
  const groupsMap = new Map<string, { groupId: string | null; groupName: string; players: typeof players }>()
  for (const p of players) {
    const key = p.groupId ?? 'ungrouped'
    if (!groupsMap.has(key)) groupsMap.set(key, { groupId: p.groupId, groupName: p.groupName, players: [] })
    groupsMap.get(key)!.players.push(p)
  }

  return NextResponse.json({ groups: Array.from(groupsMap.values()) })
}
