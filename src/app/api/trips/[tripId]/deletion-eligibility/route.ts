import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteProps { params: Promise<{ tripId: string }> }

/**
 * GET /api/trips/[tripId]/deletion-eligibility
 *
 * P0 Permanent Delete safety gate (10 Sep). Read-only -- calls the
 * exact same trip_has_protected_history() RPC the DELETE route itself
 * uses as its authoritative gate, so the UI's "can I show Delete
 * Permanently" question and the server's "will I actually allow this"
 * question can never drift apart into two different implementations.
 * This endpoint is advisory only for the UI's own display decision --
 * the DELETE route re-checks independently and is what actually
 * matters; this route cannot be used to bypass that.
 */
export async function GET(_req: Request, { params }: RouteProps) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const tripRes = await admin.from('trips').select('organiser_id, status').eq('id', tripId).maybeSingle()
  if (!tripRes.data) return NextResponse.json({ error: 'Event not found.' }, { status: 404 })
  if (tripRes.data.organiser_id !== user.id) return NextResponse.json({ error: 'Not authorised.' }, { status: 403 })

  if (tripRes.data.status !== 'archived') {
    return NextResponse.json({ eligible: false, isArchived: false, hasProtectedHistory: null })
  }

  const historyRes = await admin.rpc('trip_has_protected_history', { p_trip_id: tripId })
  if (historyRes.error) {
    return NextResponse.json({ error: 'Could not check event history.' }, { status: 500 })
  }

  return NextResponse.json({
    eligible: historyRes.data !== true,
    isArchived: true,
    hasProtectedHistory: historyRes.data === true,
  })
}
