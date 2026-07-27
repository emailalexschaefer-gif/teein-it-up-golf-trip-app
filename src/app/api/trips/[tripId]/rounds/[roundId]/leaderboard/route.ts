/**
 * GET /api/trips/[tripId]/rounds/[roundId]/leaderboard
 * Returns live Stableford leaderboard for a round, sorted by total points DESC
 * (ties broken by fewer holes played — you're "ahead" on countback while a
 * group with fewer holes completed has the same total).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// This is a polling endpoint — never cache it. Without this, Next.js could
// serve one stale response to every poll instead of hitting Supabase fresh
// (the exact bug found and fixed in the my-scores/groups routes earlier).
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

interface ScoreEntryRow { id: string; hole_id: string; gross_score: number; stableford_pts: number; is_no_return: boolean; capture_role: string }
interface ScorecardRow {
  id: string; player_id: string; playing_handicap: number; status: string
  profiles: { full_name: string; avatar_url: string | null } | null
  score_entries: ScoreEntryRow[]
}

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

  const roundRes = await admin.from('rounds').select('id, name, holes, status, scoring_format').eq('id', roundId).eq('trip_id', tripId).maybeSingle()
  if (!roundRes.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })
  const totalHoles: number = roundRes.data.holes ?? 18

  // Fetch scorecards with player info and their score entries (including
  // capture_role — required to avoid double-counting self+marker rows).
  const { data: scorecards, error: scErr } = await admin
    .from('scorecards')
    .select(`
      id, player_id, playing_handicap, status,
      profiles:player_id ( full_name, avatar_url ),
      score_entries ( id, hole_id, gross_score, stableford_pts, is_no_return, capture_role )
    `)
    .eq('round_id', roundId)
    .neq('status', 'withdrawn')

  if (scErr) {
    console.error('[leaderboard]', scErr)
    return NextResponse.json({ error: 'Could not load leaderboard.' }, { status: 500 })
  }

  const unranked = ((scorecards ?? []) as ScorecardRow[]).map((sc) => {
    // Only 'self' entries count toward the total — a scorecard can have both
    // a 'self' row and a 'marker' row for the same hole (migration 022
    // widened the unique constraint to (scorecard_id, hole_id, capture_role)
    // specifically to allow that), and summing both would double-count any
    // hole currently mid-reconciliation. The player's own running total
    // elsewhere in the app (SelfMarkerScoreShell) already treats 'self' as
    // authoritative for this exact reason — this matches that convention,
    // not a new one.
    const selfEntries = (sc.score_entries ?? []).filter(e => e.capture_role === 'self')
    const totalPts = selfEntries.reduce((sum, e) => sum + (e.stableford_pts ?? 0), 0)
    const holesPlayed = selfEntries.length
    return {
      playerId:      sc.player_id,
      name:          sc.profiles?.full_name ?? 'Player',
      avatarUrl:     sc.profiles?.avatar_url ?? null,
      handicap:      sc.playing_handicap,
      totalPts,
      holesPlayed,
      finished:      holesPlayed >= totalHoles,
      isCurrentUser: sc.player_id === user.id,
    }
  }).sort((a, b) => b.totalPts - a.totalPts || b.holesPlayed - a.holesPlayed)

  // Assign 1-indexed position, with ties (same points AND same holes played)
  // sharing a position rather than being arbitrarily split.
  const board = unranked.map((row, i) => {
    const position = i === 0 ? 1
      : (row.totalPts === unranked[i - 1].totalPts && row.holesPlayed === unranked[i - 1].holesPlayed)
        ? (unranked[i - 1] as { position?: number }).position ?? i
        : i + 1
    ;(row as { position?: number }).position = position
    return { ...row, position }
  })

  return NextResponse.json({
    board,
    roundId,
    roundName: roundRes.data.name,
    scoringFormat: roundRes.data.scoring_format,
    totalHoles,
    scoringNow: board.filter(p => p.holesPlayed > 0 && !p.finished).length,
    finishedCount: board.filter(p => p.finished).length,
  })
}
