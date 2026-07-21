/**
 * GET /api/trips/[tripId]/rounds/[roundId]/scorecards
 * Returns scorecards with player details for an active round.
 * Used by the scoring session shell (Sprint 5A) and score entry (Sprint 5B).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  // Verify caller is a trip member
  const memberCheck = await admin
    .from('trip_members')
    .select('id, role')
    .eq('trip_id', tripId)
    .eq('profile_id', user.id)
    .maybeSingle()

  if (!memberCheck.data) {
    return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })
  }

  // Fetch scorecards with player profile and group info
  const result = await admin
    .from('scorecards')
    .select(`
      id, round_id, player_id, playing_handicap, status, submitted_at,
      profiles:player_id ( id, full_name, avatar_url ),
      trip_members!inner ( group_id, trip_groups:group_id ( id, name, tee_time ) )
    `)
    .eq('round_id', roundId)
    .neq('status', 'withdrawn')
    .order('playing_handicap', { ascending: true })

  if (result.error) {
    console.error('[GET scorecards]', result.error)
    return NextResponse.json({ error: 'Could not load scorecards.' }, { status: 500 })
  }

  // Also fetch the round itself to confirm it belongs to this trip
  const roundRes = await admin
    .from('rounds')
    .select('id, name, status, holes, scoring_format, course_name, tee_time, play_date')
    .eq('id', roundId)
    .eq('trip_id', tripId)
    .single()

  if (!roundRes.data) {
    return NextResponse.json({ error: 'Round not found.' }, { status: 404 })
  }

  return NextResponse.json({
    round: roundRes.data,
    scorecards: result.data ?? [],
    isOrganiser: memberCheck.data.role === 'organiser',
  })
}
