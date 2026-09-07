import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'

/**
 * POST /api/practice/create
 *
 * Separate Solo Event Play from Practice Round Mode (5 Sep) -- the
 * minimal Practice Round entry point. Deliberately its own route
 * rather than the normal multi-step trip wizard: a Practice Round
 * needs one screen, not a name/dates/description/expected-players
 * flow built for a real multi-player Event.
 *
 * Orchestrates the same underlying writes the normal trip-creation
 * path already makes (trips insert, trip_members, trip_groups,
 * rounds, begin_round) rather than inventing a second creation
 * mechanism -- this route exists because doing all of that in one
 * atomic server-side action, ending with the round already started,
 * is genuinely a different UX shape than the organiser wizard, not
 * because the underlying data model needed to differ.
 *
 * Course Library is NOT integrated in this first pass -- per the
 * explicit "keep it minimal, do not expand into a large Practice
 * analytics project" instruction, hole data uses a standard, uniform
 * par-72 default layout rather than a real course's actual par/SI.
 * courseName is a free-text label only. This is a real, named scope
 * limitation, not an oversight -- see the delivery report.
 */

const STANDARD_18: { hole_number: number; par: number; stroke_index: number }[] = [
  { hole_number: 1, par: 4, stroke_index: 7 }, { hole_number: 2, par: 4, stroke_index: 13 },
  { hole_number: 3, par: 3, stroke_index: 17 }, { hole_number: 4, par: 5, stroke_index: 3 },
  { hole_number: 5, par: 4, stroke_index: 9 }, { hole_number: 6, par: 4, stroke_index: 1 },
  { hole_number: 7, par: 3, stroke_index: 15 }, { hole_number: 8, par: 5, stroke_index: 5 },
  { hole_number: 9, par: 4, stroke_index: 11 }, { hole_number: 10, par: 4, stroke_index: 8 },
  { hole_number: 11, par: 4, stroke_index: 14 }, { hole_number: 12, par: 3, stroke_index: 18 },
  { hole_number: 13, par: 5, stroke_index: 4 }, { hole_number: 14, par: 4, stroke_index: 10 },
  { hole_number: 15, par: 4, stroke_index: 2 }, { hole_number: 16, par: 3, stroke_index: 16 },
  { hole_number: 17, par: 5, stroke_index: 6 }, { hole_number: 18, par: 4, stroke_index: 12 },
]

const PracticeCreateSchema = z.object({
  courseName: z.string().max(100).default(''),
  teeName: z.string().max(50).default(''),
  holes: z.union([z.literal(9), z.literal(18)]).default(18),
  playDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }) }
  const parsed = PracticeCreateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed.', issues: parsed.error.issues }, { status: 400 })
  const { courseName, teeName, holes, playDate } = parsed.data

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const profileRes = await admin.from('profiles').select('full_name, handicap').eq('id', user.id).maybeSingle()
  const playerName = profileRes.data?.full_name ?? 'Player'
  // Same rounding convention already established for playing_handicap
  // elsewhere in this app (WHS alignment -- Math.round, not Math.floor).
  const playingHandicap = profileRes.data?.handicap != null ? Math.round(Number(profileRes.data.handicap)) : 0

  // -- Trip (is_practice = true) --------------------------------------------
  const tripRes = await admin.from('trips').insert({
    organiser_id: user.id,
    name: `Practice — ${courseName || 'Round'}`,
    start_date: playDate, end_date: playDate,
    status: 'live',
    is_practice: true,
  }).select('id').single()

  if (tripRes.error || !tripRes.data) {
    console.error('[practice/create] trip insert failed', tripRes.error?.message)
    return NextResponse.json({ error: 'Could not create your practice round.' }, { status: 500 })
  }
  const tripId = tripRes.data.id

  // -- Organiser membership (same shape as the normal trip route) ----------
  const memberRes = await admin.from('trip_members').insert({ trip_id: tripId, profile_id: user.id, role: 'organiser' }).select('id').single()
  if (memberRes.error) {
    await admin.from('trips').delete().eq('id', tripId)
    return NextResponse.json({ error: 'Could not set up your practice round.' }, { status: 500 })
  }

  // -- One playing group, this player only -----------------------------------
  const groupRes = await admin.from('trip_groups').insert({ trip_id: tripId, name: 'Practice', sort_order: 0 }).select('id').single()
  if (groupRes.error || !groupRes.data) {
    await admin.from('trips').delete().eq('id', tripId)
    return NextResponse.json({ error: 'Could not set up your practice round.' }, { status: 500 })
  }
  const groupId = groupRes.data.id

  await admin.from('trip_members').update({ group_id: groupId }).eq('id', memberRes.data.id)

  // -- Round -------------------------------------------------------------------
  const holeSlice = holes === 9 ? STANDARD_18.slice(0, 9) : STANDARD_18
  const roundRes = await admin.from('rounds').insert({
    trip_id: tripId,
    name: 'Practice Round',
    course_name: courseName || null,
    tee_name: teeName || null,
    play_date: playDate,
    holes,
    scoring_format: 'stableford',
    status: 'upcoming',
    starting_hole_number: 1,
  }).select('id').single()

  if (roundRes.error || !roundRes.data) {
    await admin.from('trips').delete().eq('id', tripId)
    return NextResponse.json({ error: 'Could not create your practice round.' }, { status: 500 })
  }
  const roundId = roundRes.data.id

  // -- Start it immediately -- skip Finalize Round's organiser ceremony ----
  // entirely; a Practice Round has no groups to review, no tee times to
  // set, no Course Library snapshot to confirm. Calls the exact same
  // begin_round() RPC the normal Finalize flow uses, with this one
  // player's data -- never a second, parallel "start a round" mechanism.
  const rpcResult = await admin.rpc('begin_round', {
    p_round_id: roundId,
    p_hole_data: holeSlice,
    p_scorecard_data: [{ player_id: user.id, playing_handicap: playingHandicap, scoring_method: 'digital', group_id: groupId }],
  })

  if (rpcResult.error) {
    console.error('[practice/create] begin_round failed', rpcResult.error.message)
    await admin.from('trips').delete().eq('id', tripId)
    return NextResponse.json({ error: 'Could not start your practice round.' }, { status: 500 })
  }

  return NextResponse.json({ tripId, roundId, playerName }, { status: 201 })
}
