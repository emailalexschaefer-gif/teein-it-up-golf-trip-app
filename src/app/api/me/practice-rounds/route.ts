import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/me/practice-rounds
 *
 * Practice Round My Golf display follow-up (5 Sep) -- the one new
 * query this pass needed. Reuses the exact stored
 * score_entries.stableford_pts already computed by the existing DB
 * trigger for every scorecard, Practice or Event alike -- this route
 * only sums a value that already exists, never recalculates
 * Stableford itself. No new score model, no new Practice data model:
 * this reads the same trips/rounds/scorecards/score_entries rows the
 * normal Event flow already produces, filtered to is_practice = true.
 *
 * Deliberately its own small route rather than folded into
 * /api/me/event-stories -- that route is explicitly Event-only (its
 * own query already filters is_practice = false, per the earlier
 * pass), and forcing Practice through it would either dilute that
 * filter or require a second code path inside the same route. A
 * separate, genuinely small route is the smaller, safer change.
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
    .select('id, trip_id, course_name, tee_name, play_date, holes, status')
    .in('trip_id', practiceTripIds)

  const rounds = roundsRes.data ?? []
  const roundIds = rounds.map((r: { id: string }) => r.id)

  // Same capture_role='self' convention already used everywhere else
  // in this app for a player's own official score -- reused, not
  // reinvented, for this one new query too.
  const scorecardsRes = roundIds.length > 0
    ? await admin.from('scorecards')
        .select('id, round_id, playing_handicap, score_entries(stableford_pts, capture_role)')
        .eq('player_id', user.id)
        .in('round_id', roundIds)
    : { data: [] }

  interface ScorecardRow { id: string; round_id: string; playing_handicap: number; score_entries: { stableford_pts: number | null; capture_role: string }[] }
  const scorecardByRoundId = new Map<string, ScorecardRow>(
    ((scorecardsRes.data ?? []) as unknown as ScorecardRow[]).map(sc => [sc.round_id, sc])
  )

  const practiceRounds = rounds
    .map((r: { id: string; course_name: string | null; tee_name: string | null; play_date: string | null; holes: number | null; status: string }) => {
      const sc = scorecardByRoundId.get(r.id)
      const selfEntries = (sc?.score_entries ?? []).filter(e => e.capture_role === 'self')
      const holesEntered = selfEntries.length
      const totalPts = selfEntries.reduce((sum, e) => sum + (e.stableford_pts ?? 0), 0)
      return {
        roundId: r.id,
        courseName: r.course_name,
        teeName: r.tee_name,
        playDate: r.play_date,
        holes: r.holes,
        holesEntered,
        totalPts,
        playingHandicap: sc?.playing_handicap ?? null,
        isComplete: sc ? holesEntered >= (r.holes ?? 18) : false,
      }
    })
    // Only rounds this player has actually started/entered something for
    // -- an abandoned/never-started Practice round has nothing
    // meaningful to show.
    .filter((r: { holesEntered: number }) => r.holesEntered > 0)
    .sort((a: { playDate: string | null }, b: { playDate: string | null }) => (b.playDate ?? '').localeCompare(a.playDate ?? ''))

  return NextResponse.json({ practiceRounds })
}
