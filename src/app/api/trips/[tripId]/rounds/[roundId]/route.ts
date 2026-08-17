/**
 * PATCH /api/trips/[tripId]/rounds/[roundId]
 * Body: { start_type: 'standard' | 'shotgun' }
 *
 * Minimal round-level PATCH — currently only start_type, added for
 * Shotgun Start. Deliberately narrow rather than a general-purpose
 * round editor: only the one field this feature needs, organiser-only.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

export async function PATCH(req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  type AdminClient = ReturnType<typeof createAdminClient>
  const admin: AdminClient = createAdminClient()

  const membership = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!membership.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })
  if (membership.data.role !== 'organiser') {
    return NextResponse.json({ error: 'Only the organiser can change round settings.' }, { status: 403 })
  }

  const roundCheck = await admin.from('rounds').select('id, status').eq('id', roundId).eq('trip_id', tripId).maybeSingle()
  if (!roundCheck.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (typeof body.start_type === 'string') {
    if (body.start_type !== 'standard' && body.start_type !== 'shotgun') {
      return NextResponse.json({ error: 'Invalid start type.' }, { status: 400 })
    }
    // Changing start type after the round has actually begun would be
    // genuinely confusing for players already scoring — restrict this
    // to rounds that haven't started yet, same principle as "do not
    // rewrite historical starting holes on completed rounds."
    if (roundCheck.data.status !== 'upcoming') {
      return NextResponse.json({ error: 'Start type can only be changed before the round begins.' }, { status: 409 })
    }
    const { error } = await admin.from('rounds').update({ start_type: body.start_type }).eq('id', roundId)
    if (error) return NextResponse.json({ error: "Couldn't save the start type. Please try again." }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
