/**
 * GET  /api/trips/[tripId]/rounds/[roundId]/group-tee-times
 * PATCH /api/trips/[tripId]/rounds/[roundId]/group-tee-times
 * PATCH body: { groupId: string, teeTime: string | null }
 *
 * Priority 5 — round-specific tee times. GET returns exactly what's
 * been set for THIS round, per group — a group with no row here has no
 * tee time for this round, returned as null, never silently filled in
 * from another round or from trip_groups.tee_time. PATCH is organiser-
 * only (also enforced by RLS on the table itself — this check is
 * defense in depth, matching the pattern used throughout this app) and
 * upserts a single (round_id, group_id) row, so editing Round 2 can
 * only ever touch Round 2's own row.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  type AdminClient = ReturnType<typeof createAdminClient>
  const admin: AdminClient = createAdminClient()

  const membership = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!membership.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

  const roundCheck = await admin.from('rounds').select('id').eq('id', roundId).eq('trip_id', tripId).maybeSingle()
  if (!roundCheck.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })

  const { data: teeTimes, error } = await admin
    .from('round_group_tee_times')
    .select('group_id, tee_time')
    .eq('round_id', roundId)

  if (error) return NextResponse.json({ error: 'Could not load tee times.' }, { status: 500 })

  return NextResponse.json({ teeTimes: teeTimes ?? [] })
}

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
    return NextResponse.json({ error: 'Only the organiser can edit tee times.' }, { status: 403 })
  }

  const roundCheck = await admin.from('rounds').select('id').eq('id', roundId).eq('trip_id', tripId).maybeSingle()
  if (!roundCheck.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const groupId = typeof body.groupId === 'string' ? body.groupId : null
  const teeTime = typeof body.teeTime === 'string' ? body.teeTime : null
  if (!groupId) return NextResponse.json({ error: 'A group is required.' }, { status: 400 })

  const groupCheck = await admin.from('trip_groups').select('id').eq('id', groupId).eq('trip_id', tripId).maybeSingle()
  if (!groupCheck.data) return NextResponse.json({ error: 'Group not found.' }, { status: 404 })

  const { error } = await admin
    .from('round_group_tee_times')
    .upsert({ round_id: roundId, group_id: groupId, tee_time: teeTime, updated_at: new Date().toISOString() }, { onConflict: 'round_id,group_id' })

  if (error) {
    console.error('[group-tee-times] upsert failed', { roundId, groupId, error: error.message })
    return NextResponse.json({ error: "Couldn't save the tee time. Please try again." }, { status: 500 })
  }

  return NextResponse.json({ ok: true, groupId, teeTime })
}
