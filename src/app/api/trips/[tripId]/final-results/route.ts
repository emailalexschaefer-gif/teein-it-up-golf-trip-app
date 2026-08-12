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
import { computeCumulativeStandings, determineRoundWinners, determineChampions, sortRoundsChronologically, type RoundPlayerResult } from '@/lib/scoring/multiRound'

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

    // Same stable-ordering fix as leaderboard/route.ts — created_at alone
    // is unreliable when rounds are batch-created together (identical
    // transaction-start timestamps). play_date is the primary key here,
    // with created_at/id as deterministic tiebreakers only for same-day
    // rounds. This is what makes "Round 1 Complete" / "Final Round" (or
    // any custom names) attach to the correct data regardless of which
    // physical order the INSERT happened to return them in.
    const roundsRes = await admin.from('rounds')
      .select('id, name, course_name, status, play_date, created_at')
      .eq('trip_id', tripId)
    if (roundsRes.error) throw roundsRes.error
    const sortedRounds = sortRoundsChronologically((roundsRes.data ?? []) as (RoundRow & { play_date: string })[])
    // Defensive, not assumed: only rounds actually marked completed count
    // toward results, even though trip.status === 'completed' should
    // already imply every round is (see close/route.ts's own guard).
    const completedRounds = sortedRounds.filter(r => r.status === 'completed')

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

    // ── Side Competition Winners + Powerplay Highlight (Sprint 9) ─────────
    // Explicitly grouped by round — a Side Competition existing in two
    // rounds (e.g. NTP on both Round 1 and Round 2) produces two separate
    // entries here, never collapsed into one "the" winner, per the
    // explicit instruction. trip.status === 'completed' already implies
    // every round's own scorecards have played every hole (close/
    // route.ts's own guard), which structurally guarantees every
    // configured competition's hole is closed by the time this route can
    // even be reached — but that invariant is NOT trusted blindly here:
    // each competition's closure is independently re-verified below
    // (isHoleComplete, same signal as the Side Games/tournament routes),
    // so a competition only appears as a genuine winner, never merely
    // because the round or event closed around it.
    const sideCompetitionsByRound = await Promise.all(completedRounds.map(async (round, idx) => {
      const [compsRes, holesRes, scRes] = await Promise.all([
        admin.from('side_comps').select('id, comp_type, hole_number').eq('round_id', round.id).eq('enabled', true),
        admin.from('holes').select('id, hole_number').eq('round_id', round.id),
        admin.from('scorecards').select('id, score_entries(hole_id, capture_role)').eq('round_id', round.id).neq('status', 'withdrawn'),
      ])
      const holeIdByNumber = new Map<number, string>((holesRes.data ?? []).map((h: { id: string; hole_number: number }) => [h.hole_number, h.id]))
      const activeCards = (scRes.data ?? []) as { id: string; score_entries: { hole_id: string; capture_role: string }[] }[]

      function isHoleComplete(holeNumber: number | null): boolean {
        if (holeNumber === null || activeCards.length === 0) return false
        const holeId = holeIdByNumber.get(holeNumber)
        if (!holeId) return false
        return activeCards.every(sc => (sc.score_entries ?? []).some(e => e.hole_id === holeId && e.capture_role === 'self'))
      }

      const comps = compsRes.data ?? []
      const competitions = await Promise.all(comps.map(async (comp: { id: string; comp_type: string; hole_number: number | null }) => {
        // Powerplay is a genuinely different kind of competition instance
        // — no player-submitted entries, no leader, just the best
        // authoritative score on this specific Powerplay hole. Treated as
        // just another row in this same per-instance array (own comp.id,
        // own card), not a separate round-level field — this is what
        // makes multiple Powerplay holes in one round each get their own
        // correct highlight, exactly like multiple NTPs already do.
        if (comp.comp_type === 'powerplay') {
          let powerplayBest: { playerId: string; playerName: string; points: number } | null = null
          const ppHoleId = holeIdByNumber.get(comp.hole_number ?? -1)
          if (ppHoleId) {
            const { data: ppEntries } = await admin.from('score_entries').select('stableford_pts, scorecard_id').eq('hole_id', ppHoleId).eq('capture_role', 'self')
            const top = ((ppEntries ?? []) as { stableford_pts: number | null; scorecard_id: string }[])
              .filter(e => e.stableford_pts !== null).sort((a, b) => (b.stableford_pts ?? 0) - (a.stableford_pts ?? 0))[0]
            if (top) {
              const { data: sc } = await admin.from('scorecards').select('player_id, profiles:player_id(full_name)').eq('id', top.scorecard_id).maybeSingle()
              const scRow = sc as unknown as { player_id: string; profiles: { full_name: string } | null } | null
              if (scRow) powerplayBest = { playerId: scRow.player_id, playerName: scRow.profiles?.full_name ?? 'Player', points: top.stableford_pts ?? 0 }
            }
          }
          return { compType: comp.comp_type, holeNumber: comp.hole_number, winner: null, powerplayBest }
        }

        if (!isHoleComplete(comp.hole_number)) return { compType: comp.comp_type, holeNumber: comp.hole_number, winner: null, powerplayBest: null }

        const [entriesRes, changesRes] = await Promise.all([
          admin.from('side_comp_entries').select('player_id, qualified, result_value, moment_id, profiles:player_id(full_name)').eq('side_comp_id', comp.id),
          comp.comp_type === 'longest_drive'
            ? admin.from('side_comp_lead_changes').select('player_id, moment_id, sequence_number, profiles:player_id(full_name)').eq('side_comp_id', comp.id).order('sequence_number', { ascending: false })
            : Promise.resolve({ data: [] }),
        ])
        type EntryRow = { player_id: string; qualified: boolean; result_value: number | null; moment_id: string | null; profiles: { full_name: string } | null }
        const entries = (entriesRes.data ?? []) as unknown as EntryRow[]

        let winner: { playerId: string; playerName: string; resultValue: number | null; momentId: string | null } | null = null
        if (comp.comp_type === 'longest_drive') {
          type ChangeRow = { player_id: string; moment_id: string | null; profiles: { full_name: string } | null }
          for (const change of ((changesRes.data ?? []) as unknown as ChangeRow[])) {
            const entry = entries.find(e => e.player_id === change.player_id)
            if (entry?.qualified) { winner = { playerId: change.player_id, playerName: change.profiles?.full_name ?? 'Player', resultValue: null, momentId: entry.moment_id ?? change.moment_id }; break }
          }
        } else {
          const best = entries.filter(e => e.qualified && e.result_value !== null).sort((a, b) => (a.result_value ?? 0) - (b.result_value ?? 0))[0]
          if (best) winner = { playerId: best.player_id, playerName: best.profiles?.full_name ?? 'Player', resultValue: best.result_value, momentId: best.moment_id }
        }
        return { compType: comp.comp_type, holeNumber: comp.hole_number, winner, powerplayBest: null as { playerId: string; playerName: string; points: number } | null }
      }))

      return { roundId: round.id, roundNumber: idx + 1, roundName: round.name, courseName: round.course_name, competitions }
    }))

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
      sideCompetitionsByRound,
    })
  } catch (err) {
    console.error('[final-results]', err)
    return NextResponse.json({ error: 'Could not load final results.' }, { status: 500 })
  }
}
