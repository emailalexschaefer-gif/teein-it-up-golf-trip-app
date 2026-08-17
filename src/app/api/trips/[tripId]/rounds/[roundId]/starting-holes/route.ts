/**
 * GET  /api/trips/[tripId]/rounds/[roundId]/starting-holes
 * PATCH /api/trips/[tripId]/rounds/[roundId]/starting-holes
 * PATCH body: { groupId: string, startingHole: number }
 *
 * Shotgun Start — round+group scoped starting hole, matching the same
 * pattern already established for group-tee-times (migration 053).
 * GET returns exactly what's set for THIS round; a group with no row
 * has no assignment, returned as absent from the list — the player-
 * side fallback picker is what handles that, not a default baked in
 * here.
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

  const roundCheck = await admin.from('rounds').select('id, start_type').eq('id', roundId).eq('trip_id', tripId).maybeSingle()
  if (!roundCheck.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })

  const { data: startingHoles, error } = await admin
    .from('round_group_starting_holes')
    .select('group_id, starting_hole')
    .eq('round_id', roundId)

  if (error) return NextResponse.json({ error: 'Could not load starting holes.' }, { status: 500 })

  return NextResponse.json({ startType: roundCheck.data.start_type, startingHoles: startingHoles ?? [] })
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
    return NextResponse.json({ error: 'Only the organiser can assign starting holes.' }, { status: 403 })
  }

  const roundCheck = await admin.from('rounds').select('id, holes').eq('id', roundId).eq('trip_id', tripId).maybeSingle()
  if (!roundCheck.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const groupId = typeof body.groupId === 'string' ? body.groupId : null
  const startingHole = typeof body.startingHole === 'number' ? body.startingHole : null
  if (!groupId) return NextResponse.json({ error: 'A group is required.' }, { status: 400 })
  if (startingHole === null || startingHole < 1) {
    return NextResponse.json({ error: 'A valid starting hole is required.' }, { status: 400 })
  }

  // Only holes that actually exist in this round's configuration.
  const holeCount: number = roundCheck.data.holes ?? 18
  if (startingHole > holeCount) {
    return NextResponse.json({ error: `This round only has ${holeCount} holes.` }, { status: 400 })
  }

  const groupCheck = await admin.from('trip_groups').select('id').eq('id', groupId).eq('trip_id', tripId).maybeSingle()
  if (!groupCheck.data) return NextResponse.json({ error: 'Group not found.' }, { status: 404 })

  const { error } = await admin
    .from('round_group_starting_holes')
    .upsert({ round_id: roundId, group_id: groupId, starting_hole: startingHole, updated_at: new Date().toISOString() }, { onConflict: 'round_id,group_id' })

  if (error) {
    console.error('[starting-holes] upsert failed', { roundId, groupId, error: error.message })
    return NextResponse.json({ error: "Couldn't save the starting hole. Please try again." }, { status: 500 })
  }

  return NextResponse.json({ ok: true, groupId, startingHole })
}
