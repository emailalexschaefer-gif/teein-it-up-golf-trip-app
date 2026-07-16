// PATCH /api/trips/[tripId] — edit an existing trip (organiser only)

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface Props { params: Promise<{ tripId: string }> }

export async function PATCH(request: NextRequest, { params }: Props) {
  const { tripId } = await params
  const supabase   = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  // Verify organiser
  const tripRes = await admin.from('trips').select('organiser_id').eq('id', tripId).single()
  if (!tripRes.data || tripRes.data.organiser_id !== user.id) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Build update object from known-safe base columns only
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  // Sprint 1-2 columns — always safe
  if (body.name        !== undefined) update.name        = body.name
  if (body.event_type  !== undefined) update.event_type  = body.event_type  || null
  if (body.location    !== undefined) update.location    = body.location    || null
  if (body.start_date  !== undefined) update.start_date  = body.start_date
  if (body.end_date    !== undefined) update.end_date    = body.end_date
  if (body.description !== undefined) update.description = body.description || null

  // Sprint 3 columns — try first, fall back gracefully if not in schema yet
  const sprint3Fields: Record<string, unknown> = {}
  if (body.expected_players     !== undefined) sprint3Fields.expected_players     = body.expected_players
  if (body.players_per_group    !== undefined) sprint3Fields.players_per_group    = body.players_per_group
  if (body.organiser_is_playing !== undefined) sprint3Fields.organiser_is_playing = body.organiser_is_playing

  // Try full update with Sprint 3 fields
  if (Object.keys(sprint3Fields).length > 0) {
    const { error: updateError } = await admin
      .from('trips').update({ ...update, ...sprint3Fields }).eq('id', tripId)

    if (updateError) {
      const msg = updateError.message ?? ''
      const isMissingCol = msg.includes('column') || msg.includes('schema cache')

      if (isMissingCol) {
        // Sprint 3 columns not in DB yet — save base fields only and warn
        console.warn('[PATCH /api/trips] Sprint 3 columns missing, saving base fields only. Run migration 011.')
        const { error: fallbackError } = await admin
          .from('trips').update(update).eq('id', tripId)
        if (fallbackError) {
          return NextResponse.json({ error: `Failed to update trip: ${fallbackError.message}` }, { status: 500 })
        }
        // Return partial success — client knows to show the result
        return NextResponse.json({ tripId, ok: true, warning: 'Some fields could not be saved — database migration may be needed' })
      }

      return NextResponse.json({ error: `Failed to update trip: ${updateError.message}` }, { status: 500 })
    }
  } else {
    // No Sprint 3 fields — simple update
    const { error: updateError } = await admin
      .from('trips').update(update).eq('id', tripId)
    if (updateError) {
      return NextResponse.json({ error: `Failed to update trip: ${updateError.message}` }, { status: 500 })
    }
  }

  return NextResponse.json({ tripId, ok: true })
}


// DELETE /api/trips/[tripId] — permanently delete a trip (organiser only)
// Removes trip + all cascading data: trip_members, rounds, groups, scores, etc.
// All FK constraints have ON DELETE CASCADE so deleting the trip row is sufficient.
export async function DELETE(_request: NextRequest, { params }: Props) {
  const { tripId } = await params
  const supabase   = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  // Verify organiser
  const tripRes = await admin.from('trips').select('organiser_id, name').eq('id', tripId).single()
  if (!tripRes.data || tripRes.data.organiser_id !== user.id) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 403 })
  }

  // Delete the trip — all related data cascades via FK ON DELETE CASCADE:
  // trip_members, rounds, trip_groups, scorecards, score_entries, side_comps, etc.
  const { error: deleteError } = await admin.from('trips').delete().eq('id', tripId)

  if (deleteError) {
    console.error('[DELETE /api/trips] failed', { tripId, error: deleteError.message })
    return NextResponse.json({ error: 'Failed to delete trip. Please try again.' }, { status: 500 })
  }

  console.log('[DELETE /api/trips] deleted', { tripId, name: tripRes.data.name, userId: user.id })
  return NextResponse.json({ ok: true })
}
