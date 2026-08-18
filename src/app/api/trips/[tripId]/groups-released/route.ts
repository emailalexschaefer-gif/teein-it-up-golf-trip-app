/**
 * POST /api/trips/[tripId]/groups-released
 * Body: { released: boolean }
 *
 * Deployment 1 — the actual release action. Organiser-only. Deliberately
 * a simple boolean toggle, not a per-round or per-group mechanism —
 * matches the trip-wide group architecture (trip_members.group_id) this
 * project already has, rather than inventing round-scoped groups that
 * don't otherwise exist yet.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteProps { params: Promise<{ tripId: string }> }

export async function POST(req: NextRequest, { params }: RouteProps) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  type AdminClient = ReturnType<typeof createAdminClient>
  const admin: AdminClient = createAdminClient()

  const membership = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!membership.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })
  if (membership.data.role !== 'organiser') {
    return NextResponse.json({ error: 'Only the organiser can release groups.' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const released = body.released === true

  const { error } = await admin.from('trips').update({ groups_released: released }).eq('id', tripId)
  if (error) {
    console.error('[groups-released]', { tripId, error: error.message })
    return NextResponse.json({ error: "Couldn't update groups. Please try again." }, { status: 500 })
  }

  return NextResponse.json({ ok: true, released })
}
