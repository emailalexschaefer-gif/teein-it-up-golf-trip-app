import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeCumulativeStandings, determineChampions, type RoundPlayerResult } from '@/lib/scoring/multiRound'
import { orderHolesByPlaySequence } from '@/lib/scoring/holeSequence'

/**
 * GET /api/me/event-stories
 *
 * My Golf brief, item 9 — a chronological INDEX of the player's
 * completed events, each linking to the existing per-trip Event Story
 * (MyGolfEventStory.tsx / the final-results endpoint it already
 * consumes) — this route does NOT reimplement Event Story, and does
 * NOT load any trip's full final-results/highlights payload. Per the
 * explicit item 17 performance requirement ("do not load every Event
 * Story in full on initial page load... load summary/index data
 * first"), this only returns what's needed to render the index list
 * itself: name, courses, date range, and two small counts. Tapping
 * "View Event Story →" is what triggers the existing, richer
 * final-results fetch for that one specific trip — unchanged,
 * untouched, not duplicated here.
 *
 * Badge count reuses the exact same published_round_highlights source
 * as /api/me/badges (grouped by trip instead of by category here) —
 * not a second, differently-derived number. Side game win count reuses
 * the exact same side_comp_lead_changes "latest entry is the genuine
 * leader" signal already established in migration 068's RPC.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  const admin = createAdminClient()

  const membershipRes = await admin.from('trip_members')
    .select('trip_id, trips!inner ( id, name, status )')
    .eq('profile_id', user.id)
  const completedTripIds = ((membershipRes.data ?? []) as unknown as { trip_id: string; trips: { id: string; name: string; status: string } }[])
    .filter(m => m.trips?.status === 'completed')
    .map(m => m.trip_id)

  if (completedTripIds.length === 0) {
    return NextResponse.json({ eventStories: [] })
  }

  const [roundsRes, highlightsRes, leadersRes, tripsRes] = await Promise.all([
    admin.from('rounds').select('id, trip_id, course_name, play_date, status, holes, starting_hole_number').in('trip_id', completedTripIds),
    admin.from('published_round_highlights').select('trip_id, highlights').in('trip_id', completedTripIds),
    admin.from('side_comp_lead_changes')
      .select('side_comp_id, player_id, sequence_number, side_comps!inner ( trip_id )')
      .order('sequence_number', { ascending: false }),
    admin.from('trips').select('id, name').in('id', completedTripIds),
  ])

  const tripNameById = new Map((tripsRes.data ?? []).map((t: { id: string; name: string }) => [t.id, t.name]))

  interface RoundRow { id: string; trip_id: string; course_name: string | null; play_date: string | null; status: string; holes: number | null; starting_hole_number: number | null }
  const allRounds = (roundsRes.data ?? []) as RoundRow[]

  const roundsByTrip = new Map<string, RoundRow[]>()
  for (const r of allRounds) {
    const list = roundsByTrip.get(r.trip_id) ?? []
    list.push(r)
    roundsByTrip.set(r.trip_id, list)
  }

  const badgeCountByTrip = new Map<string, number>()
  for (const row of (highlightsRes.data ?? []) as { trip_id: string; highlights: { playerId: string }[] }[]) {
    const mine = (row.highlights ?? []).filter(h => h.playerId === user.id).length
    if (mine > 0) badgeCountByTrip.set(row.trip_id, (badgeCountByTrip.get(row.trip_id) ?? 0) + mine)
  }

  // Latest entry per side_comp_id = genuine final leader (same signal
  // as migration 068's RPC) — dedupe client-side since this route
  // doesn't warrant its own RPC for one small aggregation.
  const seenSideComp = new Set<string>()
  const sideGameWinCountByTrip = new Map<string, number>()
  for (const row of (leadersRes.data ?? []) as unknown as { side_comp_id: string; player_id: string; side_comps: { trip_id: string } }[]) {
    if (seenSideComp.has(row.side_comp_id)) continue
    seenSideComp.add(row.side_comp_id)
    if (row.player_id !== user.id) continue
    const tripId = row.side_comps?.trip_id
    if (tripId && completedTripIds.includes(tripId)) {
      sideGameWinCountByTrip.set(tripId, (sideGameWinCountByTrip.get(tripId) ?? 0) + 1)
    }
  }

  // 1 Sep field-test bundle — item 4, Event Winner. Reuses
  // computeCumulativeStandings/determineChampions directly — the exact
  // same authoritative countback-based functions final-results/route.ts
  // already uses for the champion(s) of any single trip — not a second,
  // approximation-based winner calculation (that already exists
  // separately, deliberately documented as a simplification, in
  // migration 068's homepage summary RPC; explicitly not reused here,
  // per "do not infer... use authoritative results logic"). Only
  // computes standings — never the richer podium/round-winners/Makers &
  // Breakers/photos payload the full final-results endpoint returns —
  // keeping this index genuinely lightweight, per this route's own
  // established "index data only" principle.
  const isMyEventWinnerByTrip = new Map<string, boolean>()
  await Promise.all(completedTripIds.map(async tripId => {
    const completedRounds = (roundsByTrip.get(tripId) ?? []).filter(r => r.status === 'completed')
    if (completedRounds.length === 0) return

    const perRoundResults: RoundPlayerResult[][] = await Promise.all(completedRounds.map(async round => {
      const [scRes, holesRes] = await Promise.all([
        admin.from('scorecards').select('player_id, score_entries(stableford_pts, capture_role, hole_id)').eq('round_id', round.id).neq('status', 'withdrawn'),
        admin.from('holes').select('id, hole_number').eq('round_id', round.id),
      ])
      const holeCount: 9 | 18 = round.holes === 9 ? 9 : 18
      const startingHoleNumber: 1 | 10 = round.starting_hole_number === 10 ? 10 : 1
      const holeNumberById = new Map((holesRes.data ?? []).map((h: { id: string; hole_number: number }) => [h.id, h.hole_number]))
      const scRows = (scRes.data ?? []) as unknown as { player_id: string; score_entries: { stableford_pts: number; capture_role: string; hole_id: string }[] }[]
      return scRows.map(sc => {
        const selfEntries = (sc.score_entries ?? []).filter(e => e.capture_role === 'self')
        const rows = selfEntries
          .map(e => { const hn = holeNumberById.get(e.hole_id); return hn ? { hole_number: hn, points: e.stableford_pts ?? 0 } : null })
          .filter((r): r is { hole_number: number; points: number } => r !== null)
        const holePoints = orderHolesByPlaySequence(rows, holeCount, startingHoleNumber).map(r => r.points)
        return {
          playerId: sc.player_id, playerName: '',
          roundPoints: selfEntries.reduce((sum, e) => sum + (e.stableford_pts ?? 0), 0),
          holePoints,
        }
      })
    }))

    const standings = computeCumulativeStandings(perRoundResults)
    const champions = determineChampions(standings)
    isMyEventWinnerByTrip.set(tripId, champions.some(c => c.playerId === user.id))
  }))

  const eventStories = completedTripIds.map(tripId => {
    const rounds = roundsByTrip.get(tripId) ?? []
    const courses = [...new Set(rounds.map(r => r.course_name).filter((c): c is string => !!c))]
    const dates = rounds.map(r => r.play_date).filter((d): d is string => !!d).sort()
    return {
      tripId,
      tripName: tripNameById.get(tripId) ?? 'Event',
      courses,
      startDate: dates[0] ?? null,
      endDate: dates[dates.length - 1] ?? null,
      isEventWinner: isMyEventWinnerByTrip.get(tripId) ?? false,
      badgeCount: badgeCountByTrip.get(tripId) ?? 0,
      sideGameWinCount: sideGameWinCountByTrip.get(tripId) ?? 0,
    }
  }).sort((a, b) => (b.endDate ?? '').localeCompare(a.endDate ?? '')) // most recent event first

  return NextResponse.json({ eventStories })
}
