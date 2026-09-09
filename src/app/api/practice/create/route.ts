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

/**
 * GET /api/practice/create
 *
 * Practice Round Course Library + profile handicap follow-up (8 Sep) --
 * a small, additive companion to the POST handler below, in the same
 * file/route since both exist purely to support the one Practice
 * creation screen. Returns the player's own stored profile handicap so
 * the setup screen can pre-populate it and display it before the
 * player ever submits -- reusing the exact same profiles.handicap
 * column and rounding convention the POST handler already reads at
 * creation time, not a second source of truth.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()
  const profileRes = await admin.from('profiles').select('handicap').eq('id', user.id).maybeSingle()
  const handicap = profileRes.data?.handicap != null ? Math.round(Number(profileRes.data.handicap)) : null
  return NextResponse.json({ handicap })
}

const LibraryHoleSchema = z.object({
  hole_number: z.number().int().min(1).max(18),
  par: z.number().int().min(3).max(6),
  stroke_index: z.number().int().min(1).max(18).nullable().optional(),
  distance: z.number().int().nullable().optional(),
})

const PracticeCreateSchema = z.object({
  courseName: z.string().max(100).default(''),
  teeName: z.string().max(50).default(''),
  holes: z.union([z.literal(9), z.literal(18)]).default(18),
  // Consolidated field-test package (8 Sep), items 2+3 — the new
  // golfer-authoritative hole model. nineSelection required when
  // holes=9, startingHole required when holes=18 — validated below,
  // not in the schema itself, so a genuinely bad combination gets a
  // clear error message rather than a generic Zod one.
  nineSelection: z.enum(['front', 'back']).optional(),
  startingHole: z.union([z.literal(1), z.literal(10)]).optional(),
  // Practice V2 (8 Sep), item 1 — persisted explicitly to
  // rounds.track_practice_stats below, never inferred later.
  trackStats: z.boolean(),
  playDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Practice Round Course Library follow-up (8 Sep) -- optional: when
  // present, this is CourseLibrarySearch's own real hole data (the
  // exact same shape/source Create Event already uses), passed
  // straight through rather than falling back to the generic
  // STANDARD_18 template below. Absent entirely for a genuinely
  // course-less practice round (manual course name, or no course name
  // at all) -- STANDARD_18 remains the fallback for that case only,
  // not removed. IMPORTANT: this is no longer used to derive the hole
  // COUNT (that bug is exactly what items 2+3 fix) — only to supply
  // real par/SI/distance for whichever hole_numbers the golfer's own
  // holes/nineSelection/startingHole choice actually requires.
  libraryHoles: z.array(LibraryHoleSchema).min(1).max(18).optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }) }
  const parsed = PracticeCreateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed.', issues: parsed.error.issues }, { status: 400 })
  const { courseName, teeName, holes, nineSelection, startingHole, trackStats, playDate, libraryHoles } = parsed.data

  // Consolidated field-test package (8 Sep), items 2+3 — the golfer's
  // own choice is validated and used to build the exact play sequence
  // of hole_numbers, entirely independent of what the selected course/
  // tee (if any) happens to have available. This is the direct fix for
  // "an 18-hole Course Library course means 18 holes are available, it
  // does not mean the golfer selected an 18-hole Practice Round" — the
  // sequence below is never touched by libraryHoles' own length.
  let holeSequence: number[]
  if (holes === 9) {
    if (nineSelection !== 'front' && nineSelection !== 'back') {
      return NextResponse.json({ error: 'Select Front 9 or Back 9.' }, { status: 400 })
    }
    holeSequence = nineSelection === 'front'
      ? [1, 2, 3, 4, 5, 6, 7, 8, 9]
      : [10, 11, 12, 13, 14, 15, 16, 17, 18]
  } else {
    if (startingHole !== 1 && startingHole !== 10) {
      return NextResponse.json({ error: 'Select 1st Tee or 10th Tee.' }, { status: 400 })
    }
    holeSequence = startingHole === 1
      ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
      : [10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2, 3, 4, 5, 6, 7, 8, 9]
  }

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
  // Consolidated field-test package (8 Sep), items 2+3 — build a full
  // hole-number -> {par, stroke_index, distance} pool first (from the
  // library selection where present, STANDARD_18 otherwise), then slice
  // it by holeSequence above — the golfer's own choice, never the
  // pool's own size. A library selection that happens to be, say, a
  // 9-hole-only tee set still works correctly here: any hole_number the
  // sequence needs that isn't in the pool falls back to STANDARD_18's
  // own value for that number, rather than failing outright.
  const libraryByHoleNumber = new Map(
    (libraryHoles ?? []).map(h => [h.hole_number, { par: h.par, stroke_index: h.stroke_index ?? h.hole_number, distance: h.distance ?? null }])
  )
  const standardByHoleNumber = new Map(STANDARD_18.map(h => [h.hole_number, { par: h.par, stroke_index: h.stroke_index, distance: null as number | null }]))
  const holeSlice = holeSequence.map(hn => {
    const src = libraryByHoleNumber.get(hn) ?? standardByHoleNumber.get(hn)!
    return { hole_number: hn, par: src.par, stroke_index: src.stroke_index, distance: src.distance }
  })

  const roundRes = await admin.from('rounds').insert({
    trip_id: tripId,
    name: 'Practice Round',
    course_name: courseName || null,
    tee_name: teeName || null,
    play_date: playDate,
    holes,
    scoring_format: 'stableford',
    status: 'upcoming',
    // Consolidated field-test package (8 Sep), item 1 — P0 root cause:
    // this round was previously created with no score_capture_mode set
    // at all, defaulting to 'self_and_marker' (the app-wide default for
    // a normal Event). A solo Practice player is never shared-device
    // (there is no partner in the group at all) and has no marker, so
    // the finalisation gate's own marker-requirement block fired for
    // every Practice round, blocking Confirm Final Scores forever.
    // 'individual' is the existing mode that already has no marker
    // concept by design — this creates Practice rounds correctly from
    // the start rather than patching around the gate afterward.
    score_capture_mode: 'individual',
    // Practice V2 (8 Sep), item 1 — the golfer's own explicit setup
    // choice, persisted directly, not inferred later from whether any
    // practice_hole_stats rows happen to exist for this round.
    track_practice_stats: trackStats,
    // The play sequence's own first hole — 1, 10, or (for a back-9
    // Practice round) 10 — never inferred from library data.
    starting_hole_number: holeSequence[0],
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
