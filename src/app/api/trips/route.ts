import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'

const SideCompSchema = z.object({
  comp_type:   z.enum(['nearest_pin', 'longest_drive', 'pros_approach', 'powerplay']),
  hole_number: z.number().int().min(1).max(18),
})

const LibraryHoleSnapshotSchema = z.object({
  hole_number:  z.number().int().min(1).max(18),
  par:          z.number().int().min(3).max(6),
  stroke_index: z.number().int().min(1).max(18).nullable(),
  distance:     z.number().int().positive().nullable(),
  // Pro Tip — without this, Zod's default strip-unknown-keys behaviour
  // would silently drop pro_tip from every snapshot before it reaches
  // the database, even though the client correctly sends it.
  pro_tip:      z.string().nullable().optional(),
})

const RoundSchema = z.object({
  name:           z.string().min(1).max(100),
  course_name:    z.string().max(100).default(''),
  play_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tee_time:       z.string().max(10).default(''),
  holes:          z.union([z.literal(9), z.literal(18)]).default(18),
  scoring_format: z.literal('stableford').default('stableford'),
  // Sprint 9 — corrected model: a round can hold multiple instances of
  // the same competition type (two NTPs on different holes, two
  // Powerplay holes) — each array entry is its own independent
  // competition, matching the schema's own UNIQUE(round_id, comp_type,
  // hole_number) rather than a one-per-type assumption.
  side_comps: z.array(SideCompSchema).max(20).default([]),
  // Course Library v1 — absent entirely for a manually-configured round.
  // A brand-new round is always 'upcoming', so writing these directly at
  // insert time is always safe, matching the reasoning already used for
  // side_comps/powerplay.
  library_tee_set_id:     z.string().uuid().nullable().default(null),
  tee_name:               z.string().max(50).nullable().default(null),
  course_rating:          z.number().nullable().default(null),
  slope_rating:           z.number().int().nullable().default(null),
  library_holes_snapshot: z.array(LibraryHoleSnapshotSchema).nullable().default(null),
})

const CreateTripSchema = z.object({
  name:              z.string().min(1, 'Trip name is required').max(100),
  event_type:        z.string().default('golf_trip'),
  location:          z.string().max(200).default(''),
  start_date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description:       z.string().max(1000).default(''),
  expected_players:  z.number().int().min(0).max(500).default(0),
  players_per_group:    z.number().int().min(2).max(8).default(4),
  organiser_is_playing: z.boolean().default(false),
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
          expected_players, players_per_group, organiser_is_playing, rounds } = parsed.data

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
      status:               'draft',
      expected_players,
      players_per_group,
      organiser_is_playing,
    })
    .select('id, invite_code')
    .single()

  // If the error mentions a missing column, retry without Sprint 3 columns
  if (tripResult?.error) {
    const errMsg: string = tripResult.error.message ?? ''
    const isMissingColumn = errMsg.includes('column') && (
      errMsg.includes('expected_players') ||
      errMsg.includes('players_per_group') ||
      errMsg.includes('organiser_is_playing')
    )

    if (isMissingColumn) {
      console.warn('[POST /api/trips] Sprint 3 columns missing — retrying without them. Run 012_sprint3_schema.sql.')
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
    const { data: insertedRounds, error: roundsError } = await admin
      .from('rounds')
      .insert(rounds.map((r: {
        name: string; course_name: string | null; play_date: string; tee_time: string | null
        holes: number; scoring_format: string
        library_tee_set_id: string | null; tee_name: string | null
        course_rating: number | null; slope_rating: number | null
        library_holes_snapshot: { hole_number: number; par: number; stroke_index: number | null; distance: number | null }[] | null
      }) => ({
        trip_id:        trip.id,
        name:           r.name,
        course_name:    r.course_name || null,
        play_date:      r.play_date,
        tee_time:       r.tee_time || null,
        holes:          r.holes,
        scoring_format: r.scoring_format,
        status:         'upcoming',
        // No powerplay_hole_number here — Powerplay is a side_comps row
        // now (comp_type = 'powerplay'), inserted below alongside every
        // other competition instance, not a special column on rounds.
        // Course Library v1 — absent (all null) for a manually-configured
        // round, exactly as intended.
        tee_set_source_id:      r.library_tee_set_id,
        tee_name:               r.tee_name,
        course_rating:          r.course_rating,
        slope_rating:           r.slope_rating,
        library_holes_snapshot: r.library_holes_snapshot,
      })))
      .select('id')

    if (roundsError) {
      // Rounds failed — clean up trip (membership cascades)
      await admin.from('trips').delete().eq('id', trip.id)
      console.error('[POST /api/trips] rounds insert failed:', roundsError.message)
      return NextResponse.json(
        { error: `Failed to create rounds: ${roundsError.message}` },
        { status: 500 }
      )
    }

    // Side Competitions — one row per configured INSTANCE, not per type.
    // A round with two NTPs on different holes produces two rows here,
    // each an independent competition (own side_comp_id, own leadership
    // history, own winner) — nothing here groups or dedupes by comp_type.
    // Rounds are inserted in the same order as the incoming array
    // (Postgres/PostgREST preserves insert order in the returned rows for
    // a single multi-row insert), so insertedRounds[i] corresponds to
    // rounds[i].
    const SIDE_COMP_LABELS: Record<string, string> = {
      nearest_pin: 'Nearest the Pin', longest_drive: 'Longest Drive', pros_approach: "Pro's Approach", powerplay: 'Powerplay',
    }
    const sideCompRows = rounds.flatMap((r: {
      side_comps?: { comp_type: string; hole_number: number }[]
    }, i: number) => {
      const roundId = insertedRounds?.[i]?.id
      if (!roundId) return []
      return (r.side_comps ?? []).map(c => ({
        trip_id: trip.id, round_id: roundId,
        name: SIDE_COMP_LABELS[c.comp_type] ?? c.comp_type, comp_type: c.comp_type,
        hole_number: c.hole_number, enabled: true,
      }))
    })

    if (sideCompRows.length > 0) {
      const { error: sideCompError } = await admin.from('side_comps').insert(sideCompRows)
      if (sideCompError) {
        // Side Comps are additive to a trip that already exists correctly
        // with its rounds — a failure here shouldn't roll back the whole
        // trip creation (unlike the rounds insert above, which the trip
        // structurally cannot exist without). Logged, surfaced, not fatal.
        console.error('[POST /api/trips] side_comps insert failed:', sideCompError.message)
      }
    }
  }

  return NextResponse.json({ tripId: trip.id, inviteCode: trip.invite_code }, { status: 201 })
}
