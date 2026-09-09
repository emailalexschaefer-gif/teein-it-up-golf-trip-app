import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculatePracticeStats, type PracticeHoleInput } from '@/lib/scoring/practiceStats'

/**
 * GET /api/me/practice-rounds
 *
 * Practice Round My Golf display follow-up (5 Sep), extended for
 * Practice History (9 Sep, item 2) -- reuses calculatePracticeStats(),
 * the exact same pure function the live My Stats route and Practice
 * Summary already call, per the explicit "we should not have three
 * separate implementations calculating the same statistics"
 * instruction. This route's only job is assembling the same
 * PracticeHoleInput[] shape from stored data, per round, and handing
 * it to that one function -- no independent fairway/GIR/putts maths
 * lives here.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const admin = createAdminClient()

  const membershipRes = await admin.from('trip_members')
    .select('trip_id, trips!inner ( id, name, status, is_practice )')
    .eq('profile_id', user.id)

  const practiceTripIds = ((membershipRes.data ?? []) as unknown as { trip_id: string; trips: { id: string; name: string; status: string; is_practice: boolean } }[])
    .filter(m => m.trips?.is_practice === true)
    .map(m => m.trip_id)

  if (practiceTripIds.length === 0) {
    return NextResponse.json({ practiceRounds: [] })
  }

  const roundsRes = await admin.from('rounds')
    .select('id, trip_id, course_name, tee_name, play_date, holes, status, track_practice_stats, starting_hole_number')
    .in('trip_id', practiceTripIds)

  const rounds = roundsRes.data ?? []
  const roundIds = rounds.map((r: { id: string }) => r.id)

  if (roundIds.length === 0) return NextResponse.json({ practiceRounds: [] })

  // Same capture_role='self' convention already used everywhere else
  // in this app for a player's own official score.
  const scorecardsRes = await admin.from('scorecards')
    .select('id, round_id, playing_handicap, score_entries(hole_id, gross_score, is_no_return, stableford_pts, capture_role)')
    .eq('player_id', user.id)
    .in('round_id', roundIds)

  interface ScorecardRow {
    id: string; round_id: string; playing_handicap: number
    score_entries: { hole_id: string; gross_score: number | null; is_no_return: boolean; stableford_pts: number | null; capture_role: string }[]
  }
  const scorecardByRoundId = new Map<string, ScorecardRow>(
    ((scorecardsRes.data ?? []) as unknown as ScorecardRow[]).map(sc => [sc.round_id, sc])
  )

  const holesRes = await admin.from('holes').select('id, round_id, hole_number, par').in('round_id', roundIds)
  interface HoleRow { id: string; round_id: string; hole_number: number; par: number }
  const holesByRoundId = new Map<string, HoleRow[]>()
  for (const h of (holesRes.data ?? []) as HoleRow[]) {
    const list = holesByRoundId.get(h.round_id) ?? []
    list.push(h)
    holesByRoundId.set(h.round_id, list)
  }

  const scorecardIds = ((scorecardsRes.data ?? []) as unknown as ScorecardRow[]).map(sc => sc.id)
  const statsRes = scorecardIds.length > 0
    ? await admin.from('practice_hole_stats').select('scorecard_id, hole_number, fairway_hit, gir, putts').in('scorecard_id', scorecardIds)
    : { data: [] }
  interface StatRow { scorecard_id: string; hole_number: number; fairway_hit: boolean | null; gir: boolean | null; putts: number | null }
  const statsByScorecardId = new Map<string, StatRow[]>()
  for (const s of (statsRes.data ?? []) as StatRow[]) {
    const list = statsByScorecardId.get(s.scorecard_id) ?? []
    list.push(s)
    statsByScorecardId.set(s.scorecard_id, list)
  }

  const practiceRounds = rounds
    .map((r: { id: string; course_name: string | null; tee_name: string | null; play_date: string | null; holes: number | null; status: string; track_practice_stats: boolean; starting_hole_number: number | null }) => {
      const sc = scorecardByRoundId.get(r.id)
      const roundHoles = holesByRoundId.get(r.id) ?? []
      const entryByHoleId = new Map(sc?.score_entries.filter(e => e.capture_role === 'self').map(e => [e.hole_id, e]) ?? [])
      const statByHoleNumber = new Map((sc ? statsByScorecardId.get(sc.id) ?? [] : []).map(s => [s.hole_number, s]))

      const holeInputs: PracticeHoleInput[] = roundHoles.map(h => {
        const entry = entryByHoleId.get(h.id)
        const stat = statByHoleNumber.get(h.hole_number)
        return {
          holeNumber: h.hole_number, par: h.par,
          grossScore: entry?.is_no_return ? null : entry?.gross_score ?? null,
          pickedUp: entry?.is_no_return ?? false,
          stablefordPts: entry?.stableford_pts ?? null,
          fairwayHit: stat?.fairway_hit ?? null, gir: stat?.gir ?? null, putts: stat?.putts ?? null,
        }
      })
      const stats = calculatePracticeStats(holeInputs)

      // 9-hole comparison rule (item 2/7 of the brief) — Front 9/Back 9
      // are recorded explicitly here (derived from the same
      // starting_hole_number the creation flow already persisted, not
      // re-guessed), so History/Progress can distinguish a 9-hole
      // round from an 18, and Front from Back, rather than treating a
      // 9-hole gross average as directly comparable to an 18-hole one.
      const totalHoles = r.holes ?? 18
      const nine: 'front' | 'back' | null = totalHoles === 9 ? (r.starting_hole_number === 10 ? 'back' : 'front') : null

      return {
        roundId: r.id,
        courseName: r.course_name,
        teeName: r.tee_name,
        playDate: r.play_date,
        holes: totalHoles,
        nine,
        startingHoleNumber: r.starting_hole_number ?? 1,
        holesEntered: stats.holesCompleted,
        totalPts: stats.stablefordTotal,
        grossTotal: stats.grossTotal,
        playingHandicap: sc?.playing_handicap ?? null,
        isComplete: sc ? stats.holesCompleted >= totalHoles : false,
        // Practice History (item 2) — absent (not zeroed) when Track
        // Stats was off, per the explicit "do not show fake 0%"
        // instruction. trackStats is the round's own persisted setup
        // choice, not inferred from whether any stat rows exist.
        trackStats: r.track_practice_stats === true,
        stats: r.track_practice_stats === true ? {
          fairwaysAnswered: stats.fairwaysAnswered, fairwaysHit: stats.fairwaysHit, fairwayPct: stats.fairwayPct,
          girAnswered: stats.girAnswered, girHit: stats.girHit, girPct: stats.girPct,
          puttsAnswered: stats.puttsAnswered, totalPutts: stats.totalPutts, puttsPerHole: stats.puttsPerHole,
        } : null,
      }
    })
    // Only rounds this player has actually started/entered something for
    // -- an abandoned/never-started Practice round has nothing
    // meaningful to show.
    .filter((r) => r.holesEntered > 0)
    .sort((a, b) => (b.playDate ?? '').localeCompare(a.playDate ?? ''))

  return NextResponse.json({ practiceRounds })
}
