/**
 * GET /api/trips/[tripId]/rounds/results
 *
 * Batched results for every completed round in this trip — one request
 * for the whole Rounds tab, not one per round card. Reuses the exact
 * same getRoundResult() helper as the Season Summary endpoint, so a
 * round's winner is never computed differently in two places.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRoundResult } from '@/lib/scoring/roundResult'

interface RouteProps { params: Promise<{ tripId: string }> }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const memberCheck = await admin.from('trip_members').select('id').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberCheck.data) return NextResponse.json({ error: 'Not a member of this event.' }, { status: 403 })

  const roundsRes = await admin
    .from('rounds')
    .select('id')
    .eq('trip_id', tripId)
    .eq('status', 'completed')

  const completedRoundIds: string[] = (roundsRes.data ?? []).map((r: { id: string }) => r.id)
  const results = await Promise.all(completedRoundIds.map(id => getRoundResult(admin, id)))

  const byRoundId: Record<string, Awaited<ReturnType<typeof getRoundResult>>> = {}
  completedRoundIds.forEach((id, i) => { byRoundId[id] = results[i] })

  return NextResponse.json({ results: byRoundId })
}
