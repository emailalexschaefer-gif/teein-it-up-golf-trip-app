// PATCH /api/trips/[tripId] — edit an existing trip (organiser only)

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'

const EditTripSchema = z.object({
  name:                 z.string().min(1).max(100).optional(),
  event_type:           z.string().optional(),
  location:             z.string().max(200).optional(),
  start_date:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date:             z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  description:          z.string().max(1000).optional(),
  expected_players:     z.number().int().min(0).max(500).optional(),
  players_per_group:    z.number().int().min(2).max(8).optional(),
  organiser_is_playing: z.boolean().optional(),
})

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
  const trip = tripRes?.data
  if (!trip || trip.organiser_id !== user.id) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 403 })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = EditTripSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 })
  }

  const { rounds, ...tripFields } = body as any
  const update: Record<string, unknown> = {
    ...tripFields,
    updated_at: new Date().toISOString(),
  }
  delete update.rounds

  const { error: updateError } = await admin
    .from('trips').update(update).eq('id', tripId)

  if (updateError) {
    return NextResponse.json({ error: `Failed to update trip: ${updateError.message}` }, { status: 500 })
  }

  return NextResponse.json({ tripId, ok: true })
}
