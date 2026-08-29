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
import { orderHolesByPlaySequence } from '@/lib/scoring/holeSequence'
import { generateEventMakersAndBreakers, type EventRoundData } from '@/lib/highlights/eventMakersBreakers'
import type { PlayerRoundData, PlayerHoleResult } from '@/lib/highlights/makersBreakers'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteProps { params: Promise<{ tripId: string }> }

// Release 2, item 1 — ScoreEntryRow/ScorecardRow (the old flat
// stableford_pts+capture_role shape, no hole_id) removed here: they're
// no longer used anywhere in this file — countback needs hole_id on
// each entry, so the inline `{ player_id, profiles, score_entries }`
// type used at the actual query call site below already carries that
// field instead.
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
    // Release 2, item 5 — extended to also fetch gross_score/par and
    // group identity, needed by generateEventMakersAndBreakers (item 4)
    // alongside the countback data this already computed — one fetch,
    // not two separate per-round queries for two different features.
    //
    // Returns { perRoundResult, eventRound } per round rather than
    // pushing into a shared array from inside these concurrent async
    // callbacks — Promise.all resolves in the same order as the input
    // array regardless of which promise finishes first, but a shared
    // array .push() from inside each callback does NOT preserve that
    // order (whichever network request happens to complete first wins
    // the race) — that would have silently scrambled event-level
    // chronological order, breaking exactly the "no cross-round
    // leakage / correct round-to-round identity" requirement this
    // whole feature depends on.
    const perRoundCombined = await Promise.all(
      completedRounds.map(async (round, roundIdx) => {
        const [{ data, error }, roundConfigRes, holesRes, groupsRes, shotgunStartsRes] = await Promise.all([
          admin
            .from('scorecards')
            .select('player_id, group_id, profiles:player_id(full_name), score_entries(stableford_pts, gross_score, capture_role, hole_id)')
            .eq('round_id', round.id).neq('status', 'withdrawn'),
          admin.from('rounds').select('holes, starting_hole_number').eq('id', round.id).maybeSingle(),
          admin.from('holes').select('id, hole_number, par').eq('round_id', round.id),
          admin.from('trip_groups').select('id, name').eq('trip_id', tripId),
          admin.from('round_group_starting_holes').select('group_id, starting_hole').eq('round_id', round.id),
        ])
        if (error) throw error
        // Release 2, item 1 — countback. holePoints must be in PLAY
        // order (holeSequence.ts), the same fix already applied to the
        // live leaderboard route — final placings must use the
        // identical ranking rule, never a second, potentially
        // disagreeing implementation.
        const holeCount: 9 | 18 = roundConfigRes.data?.holes === 9 ? 9 : 18
        const startingHoleNumber: 1 | 10 = roundConfigRes.data?.starting_hole_number === 10 ? 10 : 1
        const holeById = new Map((holesRes.data ?? []).map((h: { id: string; hole_number: number; par: number }) => [h.id, h]))
        const groupNameById = new Map((groupsRes.data ?? []).map((g: { id: string; name: string }) => [g.id, g.name]))
        // Shotgun's own per-group starting hole takes priority (same
        // resolution the round-level highlights route already uses) —
        // getPlayedSequence needs the GROUP's actual starting hole for
        // a shotgun round, not the round-level Starting Tee value,
        // which shotgun rounds never set (stays at its default of 1).
        const shotgunStartByGroup = new Map((shotgunStartsRes.data ?? []).map((r: { group_id: string; starting_hole: number }) => [r.group_id, r.starting_hole]))
        const scRows = (data ?? []) as unknown as { player_id: string; group_id: string | null; profiles: { full_name: string } | null; score_entries: { stableford_pts: number; gross_score: number; capture_role: string; hole_id: string }[] }[]

        // Release 2, item 4 — PlayerRoundData for the event engine.
        // Kept alongside, not instead of, the countback result below:
        // this has the gross_score/par detail birdies/pars/wipes need,
        // which countback's own holePoints array doesn't carry.
        const eventPlayers: PlayerRoundData[] = scRows.map(sc => {
          const selfEntries = (sc.score_entries ?? []).filter(e => e.capture_role === 'self')
          const holes: PlayerHoleResult[] = selfEntries
            .map(e => { const h = holeById.get(e.hole_id); return h ? { holeNumber: h.hole_number, stablefordPts: e.stableford_pts ?? 0, grossScore: e.gross_score, par: h.par } : null })
            .filter((h): h is PlayerHoleResult => h !== null)
            .sort((a, b) => a.holeNumber - b.holeNumber) // getPlayedSequence (called inside the event engine) expects hole-number order, then reorders into play order itself
          return {
            playerId: sc.player_id, playerName: sc.profiles?.full_name ?? 'Player',
            startingHole: (sc.group_id && shotgunStartByGroup.get(sc.group_id)) || startingHoleNumber,
            holes,
            groupId: sc.group_id, groupName: sc.group_id ? (groupNameById.get(sc.group_id) ?? 'Group') : 'Group',
          }
        })
        const eventRound: EventRoundData = { roundId: round.id, roundNumber: roundIdx + 1, totalHoles: holeCount, players: eventPlayers }

        const holeNumberById = new Map((holesRes.data ?? []).map((h: { id: string; hole_number: number }) => [h.id, h.hole_number]))
        const perRoundResult = scRows.map(sc => {
          const selfEntries = (sc.score_entries ?? []).filter(e => e.capture_role === 'self')
          const rows = selfEntries
            .map(e => { const hn = holeNumberById.get(e.hole_id); return hn ? { hole_number: hn, points: e.stableford_pts ?? 0 } : null })
            .filter((r): r is { hole_number: number; points: number } => r !== null)
          const holePoints = orderHolesByPlaySequence(rows, holeCount, startingHoleNumber).map(r => r.points)
          return {
            playerId: sc.player_id,
            playerName: sc.profiles?.full_name ?? 'Player',
            roundPoints: selfEntries.reduce((sum, e) => sum + (e.stableford_pts ?? 0), 0),
            holePoints,
          }
        })
        return { perRoundResult, eventRound }
      })
    )
    const perRoundResults: RoundPlayerResult[][] = perRoundCombined.map(c => c.perRoundResult)
    const eventRoundsData: EventRoundData[] = perRoundCombined.map(c => c.eventRound)

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
          admin.from('side_comp_entries').select('player_id, qualified, result_value, verification_status, moment_id, profiles:player_id(full_name)').eq('side_comp_id', comp.id),
          comp.comp_type === 'longest_drive'
            ? admin.from('side_comp_lead_changes').select('player_id, moment_id, sequence_number, profiles:player_id(full_name)').eq('side_comp_id', comp.id).order('sequence_number', { ascending: false })
            : Promise.resolve({ data: [] }),
        ])
        type EntryRow = { player_id: string; qualified: boolean; result_value: number | null; verification_status: string; moment_id: string | null; profiles: { full_name: string } | null }
        const entries = (entriesRes.data ?? []) as unknown as EntryRow[]

        // Verified entries only — same Stage 4 fix as the Side Games
        // route: a resubmission unconditionally resets verification_
        // status to 'pending' even for a previously-verified entry, so
        // checking `qualified` alone (Longest Drive) or `result_value !==
        // null` alone (NTP/Pro's Approach, structurally correct already
        // since result_value only exists once verified, but made
        // explicit here too) isn't sufficient on its own.
        let winner: { playerId: string; playerName: string; resultValue: number | null; momentId: string | null } | null = null
        if (comp.comp_type === 'longest_drive') {
          type ChangeRow = { player_id: string; moment_id: string | null; profiles: { full_name: string } | null }
          for (const change of ((changesRes.data ?? []) as unknown as ChangeRow[])) {
            const entry = entries.find(e => e.player_id === change.player_id)
            if (entry?.qualified && entry.verification_status === 'verified') { winner = { playerId: change.player_id, playerName: change.profiles?.full_name ?? 'Player', resultValue: null, momentId: entry.moment_id ?? change.moment_id }; break }
          }
        } else {
          const best = entries.filter(e => e.qualified && e.verification_status === 'verified' && e.result_value !== null).sort((a, b) => (a.result_value ?? 0) - (b.result_value ?? 0))[0]
          if (best) winner = { playerId: best.player_id, playerName: best.profiles?.full_name ?? 'Player', resultValue: best.result_value, momentId: best.moment_id }
        }
        return { compType: comp.comp_type, holeNumber: comp.hole_number, winner, powerplayBest: null as { playerId: string; playerName: string; points: number } | null }
      }))

      return { roundId: round.id, roundNumber: idx + 1, roundName: round.name, courseName: round.course_name, competitions }
    }))

    // Release 2, item 4/5 — the SAME event-level Makers & Breakers
    // result My Golf's Event Story (item 6) also consumes; computed
    // once here, not duplicated in either presentation layer.
    const eventHighlights = generateEventMakersAndBreakers({ rounds: eventRoundsData })

    return NextResponse.json({
      tripName: tripRes.data.name,
      rounds: completedRounds.map((r, idx) => ({ roundId: r.id, roundNumber: idx + 1, roundName: r.name, courseName: r.course_name })),
      standings: standingsWithRounds,
      roundWinners,
      champions,
      // Release 2, item 1 — now genuinely resolved via the countback
      // ladder (multiRound.ts) wherever the underlying hole-level data
      // supports it; this only stays true when players are tied all
      // the way through it, not merely level on the raw point total.
      hasTie: champions.length > 1,
      sideCompetitionsByRound,
      eventHighlights,
    })
  } catch (err) {
    console.error('[final-results]', err)
    return NextResponse.json({ error: 'Could not load final results.' }, { status: 500 })
  }
}
