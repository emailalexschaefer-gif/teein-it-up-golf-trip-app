/**
 * POST /api/trips/[tripId]/rounds/[roundId]/reinstate
 *
 * Organiser-only recovery for an accidental cancellation. Puts a cancelled
 * round back to 'upcoming'. If the event had been completed (automatically,
 * by the cancellation), it returns to 'live' so the round can be played.
 * Writes an audit entry. If a presentation has already been published it is
 * left as it is (the response says so) -- the organiser republishes it.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reinstateRound } from '@/lib/scoring/roundCancellation'

export const dynamic = 'force-dynamic'

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

export async function POST(_req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const memberCheck = await admin.from('trip_members').select('role')
    .eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberCheck.data || memberCheck.data.role !== 'organiser') {
    return NextResponse.json({ error: 'Only the organiser can reinstate a round.' }, { status: 403 })
  }

  const result = await reinstateRound(admin, { tripId, roundId, userId: user.id })
  return NextResponse.json(result.body, { status: result.status })
}
