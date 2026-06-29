import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'

const RoundSchema = z.object({
  name:           z.string().min(1).max(100),
  course_name:    z.string().max(100).default(''),
  play_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tee_time:       z.string().max(10).default(''),
  holes:          z.union([z.literal(9), z.literal(18)]).default(18),
  scoring_format: z.literal('stableford').default('stableford'),
})

const CreateTripSchema = z.object({
  name:        z.string().min(1, 'Trip name is required').max(100),
  event_type:  z.string().default('golf_trip'),
  location:    z.string().max(200).default(''),
  start_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().max(1000).default(''),
  rounds:      z.array(RoundSchema).min(1).max(10),
})

export async function POST(request: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // ── Parse ─────────────────────────────────────────────────────────────────
  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = CreateTripSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 })
  }

  const { name, event_type, location, start_date, end_date, description, rounds } = parsed.data

  if (end_date < start_date) {
    return NextResponse.json({ error: 'End date must be on or after start date' }, { status: 400 })
  }

  // ── Write ─────────────────────────────────────────────────────────────────
  const admin = createAdminClient()

  // 1. Create trip
  const tripResult = await admin
    .from('trips')
    .insert({
      organiser_id: user.id,
      name,
      event_type:  event_type  || null,
      location:    location    || null,
      description: description || null,
      start_date,
      end_date,
      status: 'draft',
    })
    .select('id, invite_code')
    .single()

  if (tripResult.error || !tripResult.data) {
    console.error('[POST /api/trips] trip:', tripResult.error)
    return NextResponse.json({ error: 'Failed to create trip' }, { status: 500 })
  }

  const trip = tripResult.data

  // 2. Organiser membership
  const { error: memberError } = await admin
    .from('trip_members')
    .insert({ trip_id: trip.id, profile_id: user.id, role: 'organiser' })

  if (memberError) {
    await admin.from('trips').delete().eq('id', trip.id)
    console.error('[POST /api/trips] member:', memberError)
    return NextResponse.json({ error: 'Failed to set up membership' }, { status: 500 })
  }

  // 3. Rounds
  if (rounds.length > 0) {
    const { error: roundsError } = await admin
      .from('rounds')
      .insert(rounds.map((r) => ({
        trip_id:        trip.id,
        name:           r.name,
        course_name:    r.course_name || null,
        play_date:      r.play_date,
        tee_time:       r.tee_time   || null,
        holes:          r.holes,
        scoring_format: r.scoring_format,
        status:         'upcoming',
      })))

    if (roundsError) {
      await admin.from('trips').delete().eq('id', trip.id)
      console.error('[POST /api/trips] rounds:', roundsError)
      return NextResponse.json({ error: 'Failed to create rounds' }, { status: 500 })
    }
  }

  return NextResponse.json({ tripId: trip.id, inviteCode: trip.invite_code }, { status: 201 })
}
