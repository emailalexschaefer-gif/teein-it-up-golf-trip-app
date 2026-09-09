import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculatePracticeStats, type PracticeHoleInput } from '@/lib/scoring/practiceStats'

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

/**
 * GET /api/trips/[tripId]/rounds/[roundId]/my-stats
 *
 * Practice V2 (8 Sep), items 4-5 -- the one route Practice's live "My
 * Stats"/"My Round", the Practice Summary screen, and (in a later
 * pass) My Golf's Practice History should all call, so live/summary/
 * history figures can never disagree with each other by construction
 * -- all three read the exact same aggregation from the exact same
 * calculatePracticeStats(), not three separate calculations.
 *
 * Reads real persisted data only: score_entries (capture_role='self',
 * the same official-score convention used everywhere else in this
 * app) for gross/Stableford, and practice_hole_stats (migration 079)
 * for fairway/GIR/putts -- never a client-side running total.
 */
export async function GET(_req: Request, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const tripRes = await admin.from('trips').select('is_practice').eq('id', tripId).maybeSingle()
  if (tripRes.data?.is_practice !== true) {
    return NextResponse.json({ error: 'My Stats is only available for a Practice round.' }, { status: 403 })
  }

  const roundRes = await admin.from('rounds').select('id, holes, track_practice_stats, starting_hole_number, course_name, tee_name, play_date, status').eq('id', roundId).eq('trip_id', tripId).maybeSingle()
  if (!roundRes.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })

  const holesRes = await admin.from('holes').select('id, hole_number, par').eq('round_id', roundId)
  const holeByNumber = new Map((holesRes.data ?? []).map((h: { id: string; hole_number: number; par: number }) => [h.hole_number, h]))

  const scorecardRes = await admin.from('scorecards').select('id').eq('round_id', roundId).eq('player_id', user.id).maybeSingle()
  const scorecardId = scorecardRes.data?.id ?? null

  const entriesRes = scorecardId
    ? await admin.from('score_entries').select('hole_id, gross_score, is_no_return, stableford_pts').eq('scorecard_id', scorecardId).eq('capture_role', 'self')
    : { data: [] }
  const entryByHoleId = new Map((entriesRes.data ?? []).map((e: { hole_id: string; gross_score: number | null; is_no_return: boolean; stableford_pts: number | null }) => [e.hole_id, e]))

  const statsRes = scorecardId && roundRes.data.track_practice_stats
    ? await admin.from('practice_hole_stats').select('hole_number, fairway_hit, gir, putts').eq('scorecard_id', scorecardId)
    : { data: [] }
  const statByHoleNumber = new Map((statsRes.data ?? []).map((s: { hole_number: number; fairway_hit: boolean | null; gir: boolean | null; putts: number | null }) => [s.hole_number, s]))

  // Play-sequence order -- same starting_hole_number concept already
  // used for Front9/Back9/10th-tee Practice rounds, so the per-hole
  // table underneath renders in actual play order, not raw hole_number
  // order.
  const totalHoles: number = roundRes.data.holes ?? 18
  const start = roundRes.data.starting_hole_number ?? 1
  const orderedNumbers: number[] = []
  if (totalHoles === 9) {
    for (let i = 0; i < 9; i++) orderedNumbers.push(start + i)
  } else {
    for (let i = 0; i < 18; i++) orderedNumbers.push(((start - 1 + i) % 18) + 1)
  }

  const perHole: (PracticeHoleInput & { grossDisplay: string })[] = orderedNumbers.map(hn => {
    const h = holeByNumber.get(hn) as { id: string; par: number } | undefined
    const entry = h ? entryByHoleId.get(h.id) as { gross_score: number | null; is_no_return: boolean; stableford_pts: number | null } | undefined : undefined
    const stat = statByHoleNumber.get(hn) as { fairway_hit: boolean | null; gir: boolean | null; putts: number | null } | undefined
    return {
      holeNumber: hn, par: h?.par ?? 4,
      grossScore: entry?.is_no_return ? null : entry?.gross_score ?? null,
      pickedUp: entry?.is_no_return ?? false,
      stablefordPts: entry?.stableford_pts ?? null,
      fairwayHit: stat?.fairway_hit ?? null, gir: stat?.gir ?? null, putts: stat?.putts ?? null,
      grossDisplay: entry?.is_no_return ? 'P' : entry?.gross_score != null ? String(entry.gross_score) : '—',
    }
  })

  const summary = calculatePracticeStats(perHole)

  return NextResponse.json({
    trackStats: roundRes.data.track_practice_stats === true,
    totalHoles,
    // Practice V2 (8 Sep), item 7 — the Practice Summary screen reuses
    // this exact same route rather than a second endpoint, so summary
    // figures can never disagree with what was live. courseName/
    // teeName/playDate/status/startingHoleNumber are metadata the
    // summary screen needs alongside the stats already computed above.
    courseName: roundRes.data.course_name as string | null,
    teeName: roundRes.data.tee_name as string | null,
    playDate: roundRes.data.play_date,
    roundStatus: roundRes.data.status,
    startingHoleNumber: start,
    summary,
    perHole: perHole.map(h => ({
      holeNumber: h.holeNumber, par: h.par, gross: h.grossDisplay, pts: h.stablefordPts,
      fairwayHit: h.fairwayHit, gir: h.gir, putts: h.putts,
    })),
  })
}
