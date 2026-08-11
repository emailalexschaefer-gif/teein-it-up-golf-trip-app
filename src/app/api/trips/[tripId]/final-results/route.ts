/**
 * GET /api/trips/[tripId]/final-results
 *
 * Authoritative Final Event Results — champion, podium, round winners, and
 * the full multi-round leaderboard, computed server-side from the same
 * locked scorecards/score_entries every other leaderboard endpoint reads,
 * and the same computeCumulativeStandings function the live multi-round
 * leaderboard already uses (see leaderboard/route.ts) — not a second,
 * parallel ranking calculation, and never decided from client-side
 * display data.
 *
 * Only serves once trip.status === 'completed' — the same status the
 * close-round route already sets automatically, and only once, when the
 * LAST remaining round closes (see close/route.ts's allRoundsComplete
 * check). This route trusts that as the single source of truth for "is
 * the event over" rather than re-deriving it here.
 *
 * Ties are never broken arbitrarily. computeCumulativeStandings already
 * gives equal totals the same position (standard 1,2,2,4 ranking); this
 * route does not invent a countback rule anywhere — round winners and
 * the champion can both legitimately be multiple players. See the
 * delivery notes for this as a flagged gap (no formal tie-break exists
 * in the product yet), not something worked around here.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeCumulativeStandings, determineRoundWinners, determineChampions, type RoundPlayerResult } from '@/lib/scoring/multiRound'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteProps { params: Promise<{ tripId: string }> }

interface ScoreEntryRow { stableford_pts: number; capture_role: string }
interface ScorecardRow { player_id: string; profiles: { full_name: string } | null; score_entries: ScoreEntryRow[] }
interface RoundRow { id: string; name: string; course_name: string | null; status: string; created_at: string }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId } = await params
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

    type AdminClient = ReturnType<typeof createAdminClient>
    const admin: AdminClient = createAdminClient()

    // Membership check only — any trip participant (organiser or player)
    // may view final results, not organiser-only. Unrelated users get no
    // row back from this query at all, so they 403 the same way every
    // other trip-scoped endpoint already does.
    const memberCheck = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
    if (!memberCheck.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

    const tripRes = await admin.from('trips').select('id, name, status').eq('id', tripId).maybeSingle()
    if (!tripRes.data) return NextResponse.json({ error: 'Trip not found.' }, { status: 404 })
    if (tripRes.data.status !== 'completed') {
      return NextResponse.json({ error: 'This event is not yet complete.' }, { status: 409 })
    }

    const roundsRes = await admin.from('rounds')
      .select('id, name, course_name, status, created_at')
      .eq('trip_id', tripId).order('created_at', { ascending: true })
    if (roundsRes.error) throw roundsRes.error
    // Defensive, not assumed: only rounds actually marked completed count
    // toward results, even though trip.status === 'completed' should
    // already imply every round is (see close/route.ts's own guard).
    const completedRounds = ((roundsRes.data ?? []) as RoundRow[]).filter(r => r.status === 'completed')

    if (completedRounds.length === 0) {
      return NextResponse.json({ error: 'No completed rounds found for this event.' }, { status: 409 })
    }

    // One query per round, same shape as the live leaderboard route's own
    // per-round fetch — reused pattern, not a new query style.
    const perRoundResults: RoundPlayerResult[][] = await Promise.all(
      completedRounds.map(async (round) => {
        const { data, error } = await admin
          .from('scorecards')
          .select('player_id, profiles:player_id(full_name), score_entries(stableford_pts, capture_role)')
          .eq('round_id', round.id).neq('status', 'withdrawn')
        if (error) throw error
        return ((data ?? []) as unknown as ScorecardRow[]).map(sc => ({
          playerId: sc.player_id,
          playerName: sc.profiles?.full_name ?? 'Player',
          roundPoints: (sc.score_entries ?? []).filter(e => e.capture_role === 'self').reduce((sum, e) => sum + (e.stableford_pts ?? 0), 0),
        }))
      })
    )

    // TOTAL and overall ranking — the exact same function, untouched, the
    // live multi-round leaderboard already relies on. Ties share position
    // (see the module's own doc comment) rather than being split
    // arbitrarily by database/array order.
    const standings = computeCumulativeStandings(perRoundResults)

    // Per-round breakdown attached to each standing, same additive
    // pattern as the live leaderboard route's cumulativeStandings.rounds
    // — R1/R2/.../Rn columns for however many rounds this event actually
    // had, never hard-coded to two.
    const pointsByPlayer = new Map<string, Record<string, number>>()
    completedRounds.forEach((round, idx) => {
      for (const r of perRoundResults[idx]) {
        const existing = pointsByPlayer.get(r.playerId) ?? {}
        existing[round.id] = r.roundPoints
        pointsByPlayer.set(r.playerId, existing)
      }
    })
    const standingsWithRounds = standings.map(s => ({
      ...s,
      rounds: completedRounds.map((round, idx) => ({
        roundId: round.id, roundNumber: idx + 1,
        points: pointsByPlayer.get(s.playerId)?.[round.id] ?? 0,
      })),
    }))

    // Round winners — the highest score within that single round only,
    // independent of the overall cumulative ranking. Tie-safe: a round
    // can legitimately have more than one winner. Pure, tested function
    // — see multiRound.ts / multiRound.test.ts.
    const roundWinners = completedRounds.map((round, idx) => ({
      roundId: round.id, roundNumber: idx + 1, roundName: round.name, courseName: round.course_name,
      winners: determineRoundWinners(perRoundResults[idx]),
    }))

    // Champion(s) — position 1 in the overall standings. Can legitimately
    // be more than one player; the UI must represent that honestly (see
    // route doc comment above), never pick one by array order. Pure,
    // tested function.
    const champions = determineChampions(standings)

    return NextResponse.json({
      tripName: tripRes.data.name,
      rounds: completedRounds.map((r, idx) => ({ roundId: r.id, roundNumber: idx + 1, roundName: r.name, courseName: r.course_name })),
      standings: standingsWithRounds,
      roundWinners,
      champions,
      // Explicit, not inferred by the client — no formal countback/tie-
      // break rule currently exists in Teein' It Up (confirmed by
      // inspection before writing this route). Flagged here so the UI
      // can show a tie honestly rather than assuming a single champion.
      hasTie: champions.length > 1,
    })
  } catch (err) {
    console.error('[final-results]', err)
    return NextResponse.json({ error: 'Could not load final results.' }, { status: 500 })
  }
}
