/**
 * POST /api/trips/[tripId]/rounds/[roundId]/cancel
 *
 * Organiser-only. Cancels an UNPLAYED ('upcoming') round -- e.g. rain stopped
 * play before it began. The round row is kept (identity, course, date, reason
 * and an audit entry), never deleted, and never given fabricated scores.
 *
 * Body: { reason?: string, preview?: boolean }
 *   preview: true -> returns the impact only, writes nothing.
 *
 * After cancelling, the same event-completion rule the close-round route uses
 * (roundLifecycle.isEventComplete) is evaluated, so cancelling the last
 * unplayed round completes the event when at least one round was completed.
 * Scoring, scorecards, side games and published results are not touched.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cancelRound } from '@/lib/scoring/roundCancellation'

export const dynamic = 'force-dynamic'

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

export async function POST(req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const memberCheck = await admin.from('trip_members').select('role')
    .eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberCheck.data || memberCheck.data.role !== 'organiser') {
    return NextResponse.json({ error: 'Only the organiser can cancel a round.' }, { status: 403 })
  }

  let body: { reason?: unknown; preview?: unknown } = {}
  try { body = await req.json() } catch { /* empty body is fine */ }

  const result = await cancelRound(admin, { tripId, roundId, userId: user.id, reason: body.reason, preview: body.preview === true })
  return NextResponse.json(result.body, { status: result.status })
}
