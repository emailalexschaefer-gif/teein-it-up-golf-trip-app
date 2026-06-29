import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'

const JoinSchema = z.object({
  invite_code: z.string().min(1).max(20),
})

// Explicit row types for every query result — prevents TypeScript inferring `never`
// when the Database generic is lost across the async function boundary.
type TripRow     = { id: string; name: string; status: string }
type ExistingRow = { id: string }

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

  const { invite_code } = parsed.data
  const admin = createAdminClient()

  // Look up trip by invite code
  const { data: trip, error: tripError } = await admin
    .from('trips')
    .select('id, name, status')
    .eq('invite_code', invite_code.toUpperCase())
    .single() as { data: TripRow | null; error: unknown }

  if (tripError || !trip) {
    return NextResponse.json({ error: 'Invite link not found' }, { status: 404 })
  }

  if (trip.status === 'archived') {
    return NextResponse.json({ error: 'This trip is no longer accepting members' }, { status: 410 })
  }

  // Already a member — idempotent
  const { data: existing } = await admin
    .from('trip_members')
    .select('id')
    .eq('trip_id', trip.id)
    .eq('profile_id', user.id)
    .single() as { data: ExistingRow | null; error: unknown }

  if (existing) {
    return NextResponse.json({ tripId: trip.id, tripName: trip.name, alreadyMember: true })
  }

  // Insert as player
  const { error: insertError } = await admin
    .from('trip_members')
    .insert({ trip_id: trip.id, profile_id: user.id, role: 'player' })

  if (insertError) {
    console.error('[POST /api/join]', insertError)
    return NextResponse.json({ error: 'Failed to join trip' }, { status: 500 })
  }

  return NextResponse.json({ tripId: trip.id, tripName: trip.name, alreadyMember: false }, { status: 201 })
}
