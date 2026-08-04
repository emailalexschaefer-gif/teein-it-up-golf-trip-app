/**
 * GET /api/trips/[tripId]/rounds/[roundId]/result
 *
 * Official result for a single round — winner(s) and points — for the
 * Rounds tab's completed-round cards. Reuses getRoundResult(), the same
 * helper Season Summary uses, so a round's winner is never computed two
 * different ways in two different places.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRoundResult } from '@/lib/scoring/roundResult'

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const memberCheck = await admin.from('trip_members').select('id').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberCheck.data) return NextResponse.json({ error: 'Not a member of this event.' }, { status: 403 })

  const roundCheck = await admin.from('rounds').select('id').eq('id', roundId).eq('trip_id', tripId).maybeSingle()
  if (!roundCheck.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })

  const result = await getRoundResult(admin, roundId)
  return NextResponse.json(result)
}
