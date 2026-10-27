/**
 * The canonical round leaderboard computation, moved verbatim out of
 * GET /api/trips/[tripId]/rounds/[roundId]/leaderboard so the member route
 * and the public leaderboard link share ONE implementation (no second
 * scoring calculation). The body below is the original route body; the only
 * changes are mechanical: `user.id` -> `viewerId`, and the two
 * `NextResponse.json(...)` returns became `{ ok, ... }` results that the route
 * turns back into the identical HTTP responses.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { computeCumulativeStandings, sortRoundsChronologically, buildRoundsSummary } from '@/lib/scoring/multiRound'
import { numberRounds } from '@/lib/trips/roundNumbering'
import { orderHolesByPlaySequence } from '@/lib/scoring/holeSequence'

type AdminClient = ReturnType<typeof createAdminClient>

interface ScoreEntryRow { id: string; hole_id: string; gross_score: number; stableford_pts: number; is_no_return: boolean; capture_role: string }
interface ScorecardRow {
  id: string; player_id: string; playing_handicap: number; status: string
  profiles: { full_name: string; avatar_url: string | null } | null
  score_entries: ScoreEntryRow[]
}
interface HoleRow { id: string; hole_number: number; par: number; stroke_index: number }

export interface RoundRowForBoard { name: string; holes: number | null; scoring_format: string | null; starting_hole_number: number | null }

export interface LeaderboardRow {
  playerId: string; name: string; avatarUrl: string | null; handicap: number; totalPts: number; holesPlayed: number
  finished: boolean; isCurrentUser: boolean; position: number
}
export interface CumulativeRow {
  playerId: string; playerName: string; totalPoints: number; position: number; roundsPlayed: number
  rounds?: { roundId: string; roundNumber: number; points: number; isCurrentRound: boolean; holesPlayed: number | null; finished: boolean }[]
}
export interface RoundLeaderboardPayload {
  board: LeaderboardRow[]; roundId: string; roundName: string; scoringFormat: string | null; totalHoles: number
  scoringNow: number; finishedCount: number; cumulativeStandings: CumulativeRow[]
  roundsSummary: { roundId: string; roundNumber: number; isLive: boolean }[]
}
export type RoundLeaderboardResult =
  | { ok: true; body: RoundLeaderboardPayload }
  | { ok: false; status: number; body: { error: string } }

export async function computeRoundLeaderboard(
  admin: AdminClient,
  p: { tripId: string; roundId: string; roundRow: RoundRowForBoard; viewerId: string | null },
): Promise<RoundLeaderboardResult> {
  const { tripId, roundId, viewerId } = p
  const roundRes = { data: p.roundRow }
  const totalHoles: number = roundRes.data.holes ?? 18
  const startingHoleNumber: 1 | 10 = roundRes.data.starting_hole_number === 10 ? 10 : 1

  // Release 3A — holes, scorecards and the event's rounds list are three
  // independent reads (all keyed only by the ids above), now issued
  // together. The rounds-list read feeds the cumulative-standings block
  // further down, which has its own try/catch: its result is wrapped so a
  // failure there (an error result OR a thrown network error) is still
  // handled INSIDE that block exactly as before — it can never fail the
  // core leaderboard, and can never become an unhandled rejection.
  const allRoundsPromise = admin
    .from('rounds').select('id, play_date, created_at, status')
    .eq('trip_id', tripId)
    .in('status', ['completed', 'active']) // include this round's own live totals, not just fully-completed ones
    .then(
      (r: { data: unknown; error: unknown }) => r,
      (e: unknown) => ({ data: null, error: e }),
    )
  const [holesRes, scorecardsRes] = await Promise.all([
    admin.from('holes').select('id, hole_number, par, stroke_index').eq('round_id', roundId),
    // Fetch scorecards with player info and their score entries (including
    // capture_role — required to avoid double-counting self+marker rows).
    admin
      .from('scorecards')
      .select(`
        id, player_id, playing_handicap, status,
        profiles:player_id ( full_name, avatar_url ),
        score_entries ( id, hole_id, gross_score, stableford_pts, is_no_return, capture_role )
      `)
      .eq('round_id', roundId)
      .neq('status', 'withdrawn'),
  ])
  // Holes for this round — needed to attach par/SI to each per-hole row
  // in the inline expanded scorecard, per the explicit "reuse existing
  // scorecard data" requirement rather than a second endpoint.
  const holeById = new Map<string, HoleRow>((holesRes.data ?? []).map((h: HoleRow) => [h.id, h]))
  const { data: scorecards, error: scErr } = scorecardsRes

  if (scErr) {
    console.error('[leaderboard]', scErr)
    return { ok: false, status: 500, body: { error: 'Could not load leaderboard.' } }
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

    // Release 2, item 1 — countback needs points in PLAY order, not
    // ascending hole_number order (identical to the fix already applied
    // in holes/route.ts for scoring navigation — same root cause,
    // different consumer). perHole above stays ascending, unchanged,
    // since it's used for hole-number-labelled display elsewhere; this
    // is a separate reordering purely for the countback key.
    const holePoints = orderHolesByPlaySequence(
      perHole.map(h => ({ hole_number: h.holeNumber, points: h.points })),
      totalHoles === 9 ? 9 : 18, startingHoleNumber,
    ).map(h => h.points)

    return {
      playerId:      sc.player_id,
      name:          sc.profiles?.full_name ?? 'Player',
      avatarUrl:     sc.profiles?.avatar_url ?? null,
      handicap:      sc.playing_handicap,
      totalPts,
      holesPlayed,
      finished:      holesPlayed >= totalHoles,
      isCurrentUser: sc.player_id === viewerId,
      perHole,
      holePoints,
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
    roundId: string; roundNumber: number; isLive: boolean
  }[] = []
  try {
    // Root cause of the "R2 LIVE shows R1 data" bug: rounds created
    // together at trip setup (a single multi-row INSERT) get IDENTICAL
    // created_at — Postgres's now() resolves to transaction-start time,
    // not per-row — so ordering by created_at alone has NO reliable
    // result when two rounds tie exactly, which they do by construction
    // here. Depending on query-plan happenstance, Round 2 could sort
    // before Round 1, silently swapping which round gets labeled
    // "roundNumber: 1" (rendered as the "R1" column) vs "roundNumber: 2"
    // ("R2 LIVE") — the data itself was always correctly round-scoped
    // (confirmed by tracing every query above), the LABELING was wrong.
    // The previous .lte('created_at', ...) filter had the same collision
    // problem from the other direction: with tied timestamps, "rounds at
    // or before this one" could silently include a later round too.
    //
    // Fixed by sorting on play_date (the organiser's actual configured
    // chronological order, which the UI already exposes as the round's
    // date) as the primary key, with created_at/id as deterministic
    // tiebreakers only for same-day rounds — then slicing by the current
    // round's ARRAY POSITION rather than a SQL inequality on a
    // collision-prone column. Fully generic for Round 3, 4, ... — no
    // round-count-specific logic anywhere in this.
    // (issued earlier, together with holes/scorecards — see allRoundsPromise)
    const allRoundsRes = await allRoundsPromise
    if (allRoundsRes.error) throw allRoundsRes.error
    const sortedRounds = sortRoundsChronologically((allRoundsRes.data ?? []) as { id: string; play_date: string; created_at: string; status: string }[])
    const currentRoundIdx = sortedRounds.findIndex(r => r.id === roundId)
    // Canonical numbers come from ALL rounds (a cancelled round keeps its number); a cancelled round is never a column or a
    // cumulative contributor (it was not played), so it is dropped here, AFTER numbering.
    const roundNumbering = numberRounds(sortedRounds)
    const relevantRoundIds: string[] = currentRoundIdx === -1 ? [] : sortedRounds.slice(0, currentRoundIdx + 1).filter(r => r.status !== 'cancelled' || r.id === roundId).map(r => r.id)
    const statusById = new Map(sortedRounds.map(r => [r.id, r.status]))

    if (relevantRoundIds.length > 0) {
      const perRoundTotals = await Promise.all(relevantRoundIds.map(async (rid) => {
        if (rid === roundId) {
            // This round's own totals are already computed above (unranked) —
            // reuse directly rather than re-querying the same data. holePoints
            // is already in play order (computed alongside perHole above).
            return unranked.map(r => ({ playerId: r.playerId, playerName: r.name, roundPoints: r.totalPts, holePoints: r.holePoints }))
          }
          const [{ data, error }, otherRoundRes, otherHolesRes] = await Promise.all([
            admin
              .from('scorecards')
              .select('player_id, profiles:player_id(full_name), score_entries(stableford_pts, capture_role, hole_id)')
              .eq('round_id', rid).neq('status', 'withdrawn'),
            admin.from('rounds').select('holes, starting_hole_number').eq('id', rid).maybeSingle(),
            admin.from('holes').select('id, hole_number').eq('round_id', rid),
          ])
          if (error) throw error
          const otherHoleCount: 9 | 18 = otherRoundRes.data?.holes === 9 ? 9 : 18
          const otherStartingHole: 1 | 10 = otherRoundRes.data?.starting_hole_number === 10 ? 10 : 1
          const otherHoleNumberById = new Map((otherHolesRes.data ?? []).map((h: { id: string; hole_number: number }) => [h.id, h.hole_number]))
          return ((data ?? []) as unknown as { player_id: string; profiles: { full_name: string } | null; score_entries: { stableford_pts: number; capture_role: string; hole_id: string }[] }[]).map(sc => {
            const selfEntries = (sc.score_entries ?? []).filter(e => e.capture_role === 'self')
            // Release 2, item 1 — same play-order reordering as the
            // current round's own holePoints above, for a prior round.
            const rows = selfEntries
              .map(e => { const hn = otherHoleNumberById.get(e.hole_id); return hn ? { hole_number: hn, points: e.stableford_pts ?? 0 } : null })
              .filter((r): r is { hole_number: number; points: number } => r !== null)
            const holePoints = orderHolesByPlaySequence(rows, otherHoleCount, otherStartingHole).map(r => r.points)
            return {
              playerId: sc.player_id,
              playerName: sc.profiles?.full_name ?? 'Player',
              roundPoints: selfEntries.reduce((sum, e) => sum + (e.stableford_pts ?? 0), 0),
              holePoints,
            }
          })
        }))
        cumulativeStandings = computeCumulativeStandings(perRoundTotals)

        // Package 1 fix — status is now derived directly from each
        // round's actual status via the extracted, unit-tested
        // buildRoundsSummary (multiRound.ts), not inferred from array
        // position. The previous version's header labeled whichever
        // column happened to be LAST in the array as "LIVE"
        // unconditionally — correct only when the roundId this route
        // was called with genuinely was the active round, but silently
        // wrong the moment a player browsed back to a completed round
        // (via the schedule) or the event fully finished: the last
        // column still said LIVE even though that round's own status
        // was 'completed'.
        const sortedRelevantRounds = relevantRoundIds.map(rid => ({ id: rid, status: statusById.get(rid) ?? 'completed' }))
        roundsSummary = buildRoundsSummary(sortedRelevantRounds, roundNumbering)

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

  return { ok: true, body: {
    board,
    roundId,
    roundName: roundRes.data.name,
    scoringFormat: roundRes.data.scoring_format,
    totalHoles,
    scoringNow: board.filter(p => p.holesPlayed > 0 && !p.finished).length,
    finishedCount: board.filter(p => p.finished).length,
    cumulativeStandings, // only meaningful once a prior completed round exists; empty array otherwise. Each entry now also carries a `rounds` breakdown (R1, R2 live, etc.) — see route comments above.
    roundsSummary, // [{roundId, roundNumber}] ascending — lets the client know whether this is Round 1 (single-column) or Round 2+ (R1|R2 LIVE|TOTAL table) without a separate request
  } }
}
