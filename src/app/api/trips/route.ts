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
  name:              z.string().min(1, 'Trip name is required').max(100),
  event_type:        z.string().default('golf_trip'),
  location:          z.string().max(200).default(''),
  start_date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description:       z.string().max(1000).default(''),
  expected_players:  z.number().int().min(0).max(500).default(0),
  players_per_group: z.number().int().min(2).max(8).default(4),
  rounds:            z.array(RoundSchema).min(1).max(10),
})

type CreatedTripShape = { id: string; invite_code: string }

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

  const parsed = CreateTripSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 })
  }

  const { name, event_type, location, start_date, end_date, description,
          expected_players, players_per_group, rounds } = parsed.data

  if (end_date < start_date) {
    return NextResponse.json({ error: 'End date must be on or after start date' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  // ── Insert trip ────────────────────────────────────────────────────────────
  // Try with Sprint 3 columns first. If the column doesn't exist yet
  // (migration 009 not applied), fall back to the Sprint 2 schema.
  // This lets trip creation work both before and after the migration.

  let tripResult = await admin
    .from('trips')
    .insert({
      organiser_id:      user.id,
      name,
      event_type:        event_type  || null,
      location:          location    || null,
      description:       description || null,
      start_date,
      end_date,
      status:            'draft',
      expected_players,
      players_per_group,
    })
    .select('id, invite_code')
    .single()

  // If the error mentions a missing column, retry without Sprint 3 columns
  if (tripResult?.error) {
    const errMsg: string = tripResult.error.message ?? ''
    const isMissingColumn = errMsg.includes('column') && (
      errMsg.includes('expected_players') ||
      errMsg.includes('players_per_group')
    )

    if (isMissingColumn) {
      console.warn('[POST /api/trips] Sprint 3 columns missing — retrying without them. Run migration 009.')
      tripResult = await admin
        .from('trips')
        .insert({
          organiser_id: user.id,
          name,
          event_type:   event_type  || null,
          location:     location    || null,
          description:  description || null,
          start_date,
          end_date,
          status:       'draft',
        })
        .select('id, invite_code')
        .single()
    }
  }

  const trip = tripResult?.data as CreatedTripShape | null
  if (tripResult?.error || !trip) {
    const detail = tripResult?.error?.message ?? 'Unknown error'
    console.error('[POST /api/trips] trip insert failed:', detail)
    // Return the real error so it's visible in browser dev tools / Vercel logs
    return NextResponse.json(
      { error: `Failed to create trip: ${detail}` },
      { status: 500 }
    )
  }

  // ── Organiser membership ───────────────────────────────────────────────────
  const { error: memberError } = await admin
    .from('trip_members')
    .insert({ trip_id: trip.id, profile_id: user.id, role: 'organiser' })

  if (memberError) {
    await admin.from('trips').delete().eq('id', trip.id)
    console.error('[POST /api/trips] member insert failed:', memberError.message)
    return NextResponse.json(
      { error: `Failed to set up membership: ${memberError.message}` },
      { status: 500 }
    )
  }

  // ── Rounds ─────────────────────────────────────────────────────────────────
  if (rounds.length > 0) {
    const { error: roundsError } = await admin
      .from('rounds')
      .insert(rounds.map((r) => ({
        trip_id:        trip.id,
        name:           r.name,
        course_name:    r.course_name || null,
        play_date:      r.play_date,
        tee_time:       r.tee_time || null,
        holes:          r.holes,
        scoring_format: r.scoring_format,
        status:         'upcoming',
      })))

    if (roundsError) {
      // Rounds failed — clean up trip (membership cascades)
      await admin.from('trips').delete().eq('id', trip.id)
      console.error('[POST /api/trips] rounds insert failed:', roundsError.message)
      return NextResponse.json(
        { error: `Failed to create rounds: ${roundsError.message}` },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({ tripId: trip.id, inviteCode: trip.invite_code }, { status: 201 })
}
