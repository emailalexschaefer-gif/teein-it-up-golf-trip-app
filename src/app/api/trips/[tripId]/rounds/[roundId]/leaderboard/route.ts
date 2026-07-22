/**
 * GET /api/trips/[tripId]/rounds/[roundId]/leaderboard
 * Returns live Stableford leaderboard for a round, sorted by total points DESC.
 * Queries leaderboard_view if available; falls back to manual calculation.
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  // Verify caller is a trip member
  const memberCheck = await admin.from('trip_members').select('role')
    .eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberCheck.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

  // Fetch scorecards with player info and their score entries
  const { data: scorecards, error: scErr } = await admin
    .from('scorecards')
    .select(`
      id, player_id, playing_handicap, status,
      profiles:player_id ( full_name, avatar_url ),
      score_entries ( id, hole_id, gross_score, stableford_pts, is_no_return )
    `)
    .eq('round_id', roundId)
    .neq('status', 'withdrawn')

  if (scErr) {
    console.error('[leaderboard]', scErr)
    return NextResponse.json({ error: 'Could not load leaderboard.' }, { status: 500 })
  }

  const board = (scorecards ?? []).map((sc: {
    id: string; player_id: string; playing_handicap: number; status: string
    profiles: { full_name: string; avatar_url: string | null } | null
    score_entries: Array<{ id: string; hole_id: string; gross_score: number; stableford_pts: number; is_no_return: boolean }>
  }) => {
    const entries = sc.score_entries ?? []
    const totalPts = entries.reduce((sum: number, e: { stableford_pts: number }) => sum + (e.stableford_pts ?? 0), 0)
    const holesPlayed = entries.length
    return {
      playerId:   sc.player_id,
      name:       sc.profiles?.full_name ?? 'Player',
      avatarUrl:  sc.profiles?.avatar_url ?? null,
      handicap:   sc.playing_handicap,
      totalPts,
      holesPlayed,
      isCurrentUser: sc.player_id === user.id,
    }
  }).sort((a: { totalPts: number }, b: { totalPts: number }) => b.totalPts - a.totalPts)

  return NextResponse.json({ board, roundId, scoringNow: board.filter((p: { holesPlayed: number }) => p.holesPlayed > 0 && p.holesPlayed < 18).length })
}
