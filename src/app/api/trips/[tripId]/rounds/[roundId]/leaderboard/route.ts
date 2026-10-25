/**
 * GET /api/trips/[tripId]/rounds/[roundId]/leaderboard
 * Returns live Stableford leaderboard for a round, sorted by total points DESC
 * (ties broken by fewer holes played — you're "ahead" on countback while a
 * group with fewer holes completed has the same total).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { withServerTiming } from '@/lib/perf/withServerTiming'
import { computeRoundLeaderboard } from '@/lib/scoring/roundLeaderboard'

// This is a polling endpoint — never cache it. Without this, Next.js could
// serve one stale response to every poll instead of hitting Supabase fresh
// (the exact bug found and fixed in the my-scores/groups routes earlier).
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

async function getHandler(_req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

    type AdminClient = ReturnType<typeof createAdminClient>
    const admin: AdminClient = createAdminClient()

    // Release 3A (performance) — the three lookups below (membership,
    // is-this-a-practice-event, and the round itself) each depend only on
    // the ids in the URL and the already-authenticated user, never on each
    // other's results, so they run together instead of one after another.
    // Their results are still evaluated in the ORIGINAL order (member 403,
    // then practice notice, then round 404), so every response is unchanged,
    // and nothing from the heavier scorecard/holes reads below is fetched
    // until the membership gate has passed.
    const [memberCheck, practiceCheck, roundRes] = await Promise.all([
      // Verify caller is a trip member
      admin.from('trip_members').select('role')
        .eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle(),
      admin.from('trips').select('is_practice').eq('id', tripId).maybeSingle(),
      admin.from('rounds').select('id, name, holes, status, scoring_format, created_at, starting_hole_number').eq('id', roundId).eq('trip_id', tripId).maybeSingle(),
    ])
    if (!memberCheck.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

  // Separate Solo Event Play from Practice Round Mode (5 Sep) — a
  // Practice Round must never appear on a competitive leaderboard, per
  // the explicit product rule. Checked here, at the very top, before
  // any standings computation runs at all — not filtered out of an
  // already-computed board, which would still mean this endpoint did
  // competitive-shaped work for a non-competitive round. Gated on
  // is_practice specifically, never group size or player count.
  if (practiceCheck.data?.is_practice) {
    return NextResponse.json({ error: 'Practice rounds do not have a competitive leaderboard.', isPractice: true }, { status: 200 })
  }

  if (!roundRes.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })
  const result = await computeRoundLeaderboard(admin, { tripId, roundId, roundRow: roundRes.data, viewerId: user.id })
  if (!result.ok) return NextResponse.json(result.body, { status: result.status })
  return NextResponse.json(result.body)
  } catch (err) {
    console.error('[leaderboard] unhandled exception', { tripId, roundId, error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({
      error: "Couldn't load the leaderboard right now.",
      debug: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }
}

// Phase A-7 — adds a Server-Timing header (no change to body/status).
export const GET = withServerTiming('leaderboard', getHandler)
