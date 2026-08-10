/**
 * GET /api/trips/[tripId]/rounds/[roundId]/leaderboard
 * Returns live Stableford leaderboard for a round, sorted by total points DESC
 * (ties broken by fewer holes played — you're "ahead" on countback while a
 * group with fewer holes completed has the same total).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeCumulativeStandings } from '@/lib/scoring/multiRound'

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
interface HoleRow { id: string; hole_number: number; par: number; stroke_index: number }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

    type AdminClient = ReturnType<typeof createAdminClient>
    const admin: AdminClient = createAdminClient()

    // Verify caller is a trip member
    const memberCheck = await admin.from('trip_members').select('role')
      .eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
    if (!memberCheck.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

  const roundRes = await admin.from('rounds').select('id, name, holes, status, scoring_format, created_at').eq('id', roundId).eq('trip_id', tripId).maybeSingle()
  if (!roundRes.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })
  const totalHoles: number = roundRes.data.holes ?? 18

  // Holes for this round — needed to attach par/SI to each per-hole row
  // in the inline expanded scorecard, per the explicit "reuse existing
  // scorecard data" requirement rather than a second endpoint.
  const holesRes = await admin.from('holes').select('id, hole_number, par, stroke_index').eq('round_id', roundId)
  const holeById = new Map<string, HoleRow>((holesRes.data ?? []).map((h: HoleRow) => [h.id, h]))

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

    // Per-hole detail for the inline expanded scorecard — same
    // selfEntries source as the total above (not a separate query or
    // calculation), sorted by hole number and joined against the holes
    // lookup for par/SI. Only included so a player can see it when they
    // expand a row; the totals above don't depend on this.
    const perHole = selfEntries
      .map(e => {
        const hole = holeById.get(e.hole_id)
        return hole ? {
          holeNumber: hole.hole_number, par: hole.par, strokeIndex: hole.stroke_index,
          gross: e.is_no_return ? null : e.gross_score,
          pickedUp: e.is_no_return, points: e.stableford_pts ?? 0,
        } : null
      })
      .filter((h): h is NonNullable<typeof h> => h !== null)
      .sort((a, b) => a.holeNumber - b.holeNumber)

    return {
      playerId:      sc.player_id,
      name:          sc.profiles?.full_name ?? 'Player',
      avatarUrl:     sc.profiles?.avatar_url ?? null,
      handicap:      sc.playing_handicap,
      totalPts,
      holesPlayed,
      finished:      holesPlayed >= totalHoles,
      isCurrentUser: sc.player_id === user.id,
      perHole,
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

  // Cumulative event totals — reuses the same capture_role='self'
  // summing convention as this round's own totals above, and the
  // already-tested computeCumulativeStandings for the ranking/summing
  // itself. Purely additive to the response: every existing field
  // (board, roundName, etc.) is unchanged, so this doesn't require any
  // UI rebuild to stay backward compatible.
  //
  // Wrapped in its own try/catch, separate from the outer handler-level
  // one: if this new addition fails for any reason, the core, already-
  // proven leaderboard must still succeed and return correctly — this
  // is the direct fix for "existing single-round behaviour must
  // continue working" even if something about the cumulative-totals
  // addition itself has an issue. Logged, not silently swallowed.
  let cumulativeStandings: ReturnType<typeof computeCumulativeStandings> = []
  // Per-round breakdown for the R1 | R2 LIVE | TOTAL table (Round 2+ only
  // on the client). Built from the exact same relevantRoundIds/
  // perRoundTotals data already fetched for cumulativeStandings below —
  // not a second query, not a second calculation. TOTAL and position on
  // each row still come directly from computeCumulativeStandings
  // (unmodified), per the explicit "reuse the existing source of truth,
  // don't invent another cumulative calculation" instruction; this only
  // adds the per-round columns alongside it.
  let roundsSummary: {
    roundId: string; roundNumber: number
  }[] = []
  try {
    const priorCompletedRes = await admin
      .from('rounds').select('id')
      .eq('trip_id', tripId).lte('created_at', roundRes.data.created_at)
      .in('status', ['completed', 'active']) // include this round's own live totals, not just fully-completed ones
      .order('created_at', { ascending: true })
    if (priorCompletedRes.error) throw priorCompletedRes.error
    const relevantRoundIds: string[] = (priorCompletedRes.data ?? []).map((r: { id: string }) => r.id)

    if (relevantRoundIds.length > 0) {
      const perRoundTotals = await Promise.all(relevantRoundIds.map(async (rid) => {
        if (rid === roundId) {
            // This round's own totals are already computed above (unranked) —
            // reuse directly rather than re-querying the same data.
            return unranked.map(r => ({ playerId: r.playerId, playerName: r.name, roundPoints: r.totalPts }))
          }
          const { data, error } = await admin
            .from('scorecards')
            .select('player_id, profiles:player_id(full_name), score_entries(stableford_pts, capture_role)')
            .eq('round_id', rid).neq('status', 'withdrawn')
          if (error) throw error
          return ((data ?? []) as unknown as { player_id: string; profiles: { full_name: string } | null; score_entries: { stableford_pts: number; capture_role: string }[] }[]).map(sc => ({
            playerId: sc.player_id,
            playerName: sc.profiles?.full_name ?? 'Player',
            roundPoints: (sc.score_entries ?? []).filter(e => e.capture_role === 'self').reduce((sum, e) => sum + (e.stableford_pts ?? 0), 0),
          }))
        }))
        cumulativeStandings = computeCumulativeStandings(perRoundTotals)

        roundsSummary = relevantRoundIds.map((rid, idx) => ({ roundId: rid, roundNumber: idx + 1 }))

        // pointsByRound[playerId][roundId] = that player's points in that
        // round. isCurrentRound rows also carry live holesPlayed/finished
        // straight from `unranked` above (same source as the round's own
        // "board" — no separate live-status calculation).
        const pointsByPlayer = new Map<string, Record<string, number>>()
        relevantRoundIds.forEach((rid, idx) => {
          for (const r of perRoundTotals[idx]) {
            const existing = pointsByPlayer.get(r.playerId) ?? {}
            existing[rid] = r.roundPoints
            pointsByPlayer.set(r.playerId, existing)
          }
        })
        const liveRowByPlayer = new Map(unranked.map(r => [r.playerId, r]))

        cumulativeStandings = cumulativeStandings.map(cs => ({
          ...cs,
          rounds: roundsSummary.map(rs => {
            const isCurrentRound = rs.roundId === roundId
            const liveRow = isCurrentRound ? liveRowByPlayer.get(cs.playerId) : undefined
            return {
              roundId: rs.roundId,
              roundNumber: rs.roundNumber,
              points: pointsByPlayer.get(cs.playerId)?.[rs.roundId] ?? 0,
              isCurrentRound,
              holesPlayed: isCurrentRound ? (liveRow?.holesPlayed ?? 0) : null,
              finished: isCurrentRound ? (liveRow?.finished ?? false) : true,
            }
          }),
        })) as typeof cumulativeStandings
      }
  } catch (cumulativeErr) {
    console.error('[leaderboard] cumulative-standings computation failed (core leaderboard still returned)', {
      tripId, roundId, error: cumulativeErr instanceof Error ? cumulativeErr.message : String(cumulativeErr),
    })
    // cumulativeStandings/roundsSummary stay at their initial empty values —
    // the response below still succeeds with the core leaderboard intact.
  }

  return NextResponse.json({
    board,
    roundId,
    roundName: roundRes.data.name,
    scoringFormat: roundRes.data.scoring_format,
    totalHoles,
    scoringNow: board.filter(p => p.holesPlayed > 0 && !p.finished).length,
    finishedCount: board.filter(p => p.finished).length,
    cumulativeStandings, // only meaningful once a prior completed round exists; empty array otherwise. Each entry now also carries a `rounds` breakdown (R1, R2 live, etc.) — see route comments above.
    roundsSummary, // [{roundId, roundNumber}] ascending — lets the client know whether this is Round 1 (single-column) or Round 2+ (R1|R2 LIVE|TOTAL table) without a separate request
  })
  } catch (err) {
    console.error('[leaderboard] unhandled exception', { tripId, roundId, error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({
      error: "Couldn't load the leaderboard right now.",
      debug: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }
}
