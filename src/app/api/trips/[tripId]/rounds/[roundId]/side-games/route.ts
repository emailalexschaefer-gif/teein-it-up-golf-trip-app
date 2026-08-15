/**
 * GET /api/trips/[tripId]/rounds/[roundId]/side-games
 *
 * Single-round Side Games — kept as the individual-round drill-down
 * view (per explicit instruction: preserve this where the architecture
 * already supports it cleanly). The default Side Games screen now uses
 * the event-level route below instead; this one still exists for
 * viewing one specific round on its own.
 *
 * All computation now lives in computeRoundSideGames (src/lib/
 * sideGames/computeRoundSideGames.ts) — extracted so the event-level
 * route calls the exact same logic rather than a second implementation.
 * Nothing about the actual computation changed in that extraction.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeRoundSideGames } from '@/lib/sideGames/computeRoundSideGames'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

    type AdminClient = ReturnType<typeof createAdminClient>
    const admin: AdminClient = createAdminClient()

    const memberCheck = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
    if (!memberCheck.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

    const roundRes = await admin.from('rounds').select('id, holes, score_capture_mode').eq('id', roundId).eq('trip_id', tripId).maybeSingle()
    if (!roundRes.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })

    const competitions = await computeRoundSideGames(admin, roundId)
    return NextResponse.json({ competitions })
  } catch (err) {
    console.error('[side-games]', err)
    return NextResponse.json({ error: 'Could not load Side Games.' }, { status: 500 })
  }
}
