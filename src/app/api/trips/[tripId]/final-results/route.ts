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
 *
 * REFACTORED for Event Memories V1.3 (13 Sep): the actual computation
 * (everything between the membership check and the response) now lives
 * in src/lib/trips/finalResults.ts (computeFinalResults), moved there
 * verbatim, so the new Event Story slideshow/export work can call the
 * exact same authoritative Champion/standings/round-winner/Side-Game-
 * winner/Makers-and-Breakers logic without duplicating it. This route's
 * own response shape is UNCHANGED — it returns exactly what
 * computeFinalResults produces; only the membership/auth check (an HTTP
 * concern) stays here.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeFinalResults } from '@/lib/trips/finalResults'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteProps { params: Promise<{ tripId: string }> }

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

    const result = await computeFinalResults(tripId, admin)
    if (!result.ok) {
      return NextResponse.json(
        result.isPractice ? { error: result.error, isPractice: true } : { error: result.error },
        { status: result.status },
      )
    }
    return NextResponse.json(result.data)
  } catch (err) {
    console.error('[final-results]', err)
    return NextResponse.json({ error: 'Could not load final results.' }, { status: 500 })
  }
}
