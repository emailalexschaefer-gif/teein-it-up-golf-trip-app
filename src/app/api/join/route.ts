import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'

const JoinSchema = z.object({
  invite_code:    z.string().min(1).max(20),
  playing_handicap: z.number().nullable().optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = JoinSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid invite code' }, { status: 400 })
  }

  const { invite_code, playing_handicap = null } = parsed.data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const tripResult = await admin
    .from('trips')
    .select('id, name, status')
    .eq('invite_code', invite_code.toUpperCase())
    .single()

  const trip = tripResult?.data ?? null
  if (tripResult?.error || !trip) {
    return NextResponse.json({ error: 'Invite link not found' }, { status: 404 })
  }

  if (trip.status === 'archived') {
    return NextResponse.json({ error: 'This trip is no longer accepting members' }, { status: 410 })
  }

  const existingResult = await admin
    .from('trip_members')
    .select('id')
    .eq('trip_id', trip.id)
    .eq('profile_id', user.id)
    .maybeSingle()

  if (existingResult?.data) {
    return NextResponse.json({ tripId: trip.id, tripName: trip.name, alreadyMember: true })
  }

  const { error: insertError } = await admin
    .from('trip_members')
    .insert({ trip_id: trip.id, profile_id: user.id, role: 'player', playing_handicap: playing_handicap ?? null })

  // Update permanent profile handicap if one was provided
  if (playing_handicap !== null && playing_handicap !== undefined) {
    await admin.from('profiles').update({ handicap: playing_handicap }).eq('id', user.id).then(() => {})
  }

  if (insertError) {
    console.error('[POST /api/join]', insertError)
    return NextResponse.json({ error: 'Failed to join trip' }, { status: 500 })
  }

  return NextResponse.json({ tripId: trip.id, tripName: trip.name, alreadyMember: false }, { status: 201 })
}
