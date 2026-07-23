/**
 * POST /api/trips/[tripId]/rounds/[roundId]/start
 *
 * Begins a round atomically. Tries the begin_round() RPC (migration 016) first;
 * if the function does not exist (migration not yet applied), falls back to
 * sequential direct inserts with the same idempotency guarantees.
 *
 * Transaction safety:
 *   - Via RPC: single PostgreSQL transaction, full rollback on any failure.
 *   - Via fallback: round status is set LAST so a partial failure leaves status 'upcoming'.
 *     Holes and scorecards use ON CONFLICT upsert — safe to retry.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePlayingHandicap } from '@/lib/scoring/defaultHoles'
import { generateMarkerAssignments } from '@/lib/scoring/markerAssignment'
import { z } from 'zod'

const HoleSchema = z.object({
  hole_number:  z.number().int().min(1).max(18),
  par:          z.number().int().min(3).max(6),
  stroke_index: z.number().int().min(1).max(18),
})

const StartSchema = z.object({
  holes: z.array(HoleSchema).min(9).max(18),
})

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

/**
 * Seeds sensible default marker assignments for every playing group in this
 * round, immediately on Begin Round — so the self+marker scoring model has
 * something to work with without the organiser having to visit the marker
 * review screen first. Still fully editable there afterward.
 *
 * A no-op for both 'group_scorer' (markers don't apply — legacy model) AND
 * 'individual' (markers don't apply — genuinely single-capture scoring,
 * no marker concept at all). Only 'self_and_marker' rounds get seeded.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function autoGenerateMarkers(admin: any, tripId: string, roundId: string, scoreCaptureMode: string) {
  if (scoreCaptureMode !== 'self_and_marker') return

  const [groupsRes, membersRes, cardsRes, existingMarkersRes] = await Promise.all([
    admin.from('trip_groups').select('id').eq('trip_id', tripId),
    admin.from('trip_members').select('profile_id, group_id').eq('trip_id', tripId),
    admin.from('scorecards').select('player_id').eq('round_id', roundId).neq('status', 'withdrawn'),
    admin.from('round_markers').select('player_id').eq('round_id', roundId),
  ])

  const groupIds: string[] = (groupsRes.data ?? []).map((g: { id: string }) => g.id)
  const cardPlayerIds = new Set((cardsRes.data ?? []).map((c: { player_id: string }) => c.player_id))
  const alreadyAssigned = new Set((existingMarkersRes.data ?? []).map((m: { player_id: string }) => m.player_id))

  for (const groupId of groupIds) {
    const groupPlayerIds: string[] = (membersRes.data ?? [])
      .filter((m: { group_id: string | null; profile_id: string }) => m.group_id === groupId && cardPlayerIds.has(m.profile_id))
      .map((m: { profile_id: string }) => m.profile_id)

    if (groupPlayerIds.length < 2) continue // solo group — nothing to pair
    if (groupPlayerIds.every(id => alreadyAssigned.has(id))) continue // already seeded

    try {
      const assignments = generateMarkerAssignments(groupPlayerIds)
      const rows = assignments.map(a => ({ round_id: roundId, player_id: a.playerId, marker_player_id: a.markerPlayerId }))
      await admin.from('round_markers').insert(rows)
    } catch (err) {
      // Don't fail Begin Round over marker seeding — the organiser can
      // still assign manually from the marker review screen.
      console.error('[start-round] auto marker generation failed for group', { roundId, groupId, err })
    }
  }
}


export async function POST(req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params

  // ── Auth ───────────────────────────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  // ── Verify organiser ───────────────────────────────────────────────────────
  const tripRes = await admin
    .from('trips')
    .select('id, organiser_id, status')
    .eq('id', tripId)
    .single()

  if (!tripRes.data) {
    console.error('[start-round] trip not found', { tripId, userId: user.id })
    return NextResponse.json({ error: 'Trip not found.' }, { status: 404 })
  }
  if (tripRes.data.organiser_id !== user.id) {
    console.warn('[start-round] not organiser', { tripId, userId: user.id, organiser: tripRes.data.organiser_id })
    return NextResponse.json({ error: 'Only the organiser can begin a round.' }, { status: 403 })
  }

  // ── Verify round ───────────────────────────────────────────────────────────
  const roundRes = await admin
    .from('rounds')
    .select('id, status, holes, name, trip_id, score_capture_mode')
    .eq('id', roundId)
    .eq('trip_id', tripId)
    .single()

  if (!roundRes.data) {
    console.error('[start-round] round not found', { roundId, tripId })
    return NextResponse.json({ error: 'Round not found in this trip.' }, { status: 404 })
  }

  const round = roundRes.data
  console.log('[start-round] round status check', { roundId, status: round.status })

  if (round.status === 'active') {
    return NextResponse.json({ error: 'This round has already started.', roundId, status: 'active' }, { status: 409 })
  }
  if (round.status === 'completed') {
    return NextResponse.json({ error: 'This round has already been completed.' }, { status: 409 })
  }

  // ── Parse hole data ────────────────────────────────────────────────────────
  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const parsed = StartSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({
      error: 'Please complete the par and stroke index for every hole before beginning.',
    }, { status: 400 })
  }

  const { holes } = parsed.data
  const holeCount: number = round.holes ?? 18

  if (holes.length !== holeCount) {
    return NextResponse.json({
      error: `Please complete the par and stroke index for all ${holeCount} holes before beginning.`,
    }, { status: 400 })
  }

  const sortedSI = [...holes.map((h: { stroke_index: number }) => h.stroke_index)].sort((a: number, b: number) => a - b)
  const siValid = sortedSI.every((si: number, i: number) => si === i + 1)
  if (!siValid) {
    return NextResponse.json({ error: `Each hole must have a unique stroke index from 1 to ${holeCount}.` }, { status: 400 })
  }

  // ── Fetch playing groups and members ───────────────────────────────────────
  const groupsRes = await admin
    .from('trip_groups')
    .select('id, name')
    .eq('trip_id', tripId)

  if (!groupsRes.data || groupsRes.data.length === 0) {
    return NextResponse.json({ error: 'Assign every player to a playing group before beginning.' }, { status: 422 })
  }

  const membersRes = await admin
    .from('trip_members')
    .select('profile_id, group_id, playing_handicap, profiles(handicap, full_name)')
    .eq('trip_id', tripId)
    .not('group_id', 'is', null)

  const assignedMembers: Array<{
    profile_id: string; group_id: string
    playing_handicap: number | null
    profiles: { handicap: number | null; full_name: string } | null
  }> = membersRes.data ?? []

  console.log('[start-round] assigned members', {
    roundId, tripId, userId: user.id,
    memberCount: assignedMembers.length,
    holeCount: holes.length,
  })

  if (assignedMembers.length === 0) {
    return NextResponse.json({ error: 'No players are assigned to groups. Assign players before beginning.' }, { status: 422 })
  }

  const missingHcp = assignedMembers.filter(m =>
    resolvePlayingHandicap(m.playing_handicap, m.profiles?.handicap) === null
  )
  if (missingHcp.length > 0) {
    const names = missingHcp.map(m => m.profiles?.full_name ?? 'Unknown').join(', ')
    return NextResponse.json({
      error: `Every player must have a playing handicap before the round can begin. Missing for: ${names}.`,
    }, { status: 422 })
  }

  // ── Build data arrays ──────────────────────────────────────────────────────
  const holeData = holes.map((h: { hole_number: number; par: number; stroke_index: number }) => ({
    hole_number: h.hole_number, par: h.par, stroke_index: h.stroke_index,
  }))

  const scorecardData = assignedMembers.map((m: typeof assignedMembers[0]) => ({
    player_id:        m.profile_id,
    playing_handicap: resolvePlayingHandicap(m.playing_handicap, m.profiles?.handicap) ?? 0,
  }))

  // ── Try RPC first, fall back to direct inserts ─────────────────────────────
  const { data: rpcResult, error: rpcError } = await admin.rpc('begin_round', {
    p_round_id:       roundId,
    p_hole_data:      holeData,
    p_scorecard_data: scorecardData,
  })

  // If RPC worked, return immediately
  if (!rpcError && rpcResult) {
    const result = rpcResult as {
      roundId: string; status: string; holesCreated: number; scorecardsCreated: number
      expectedScorecards: number; groupsProcessed: number; success: boolean
    }
    console.log('[start-round] SUCCESS via RPC', result)
    await autoGenerateMarkers(admin, tripId, roundId, round.score_capture_mode)
    return NextResponse.json(result, { status: 201 })
  }

  const rpcMsg: string = rpcError?.message ?? ''
  const rpcCode: string = rpcError?.code ?? ''
  console.warn('[start-round] RPC returned an error', {
    rpcCode, rpcMsg,
    details: rpcError?.details ?? null,
    hint:    rpcError?.hint    ?? null,
    roundId, tripId, userId: user.id,
  })

  // Known fatal errors from the round-state guard — never fall back for these.
  if (rpcMsg.includes('ROUND_NOT_UPCOMING')) {
    return NextResponse.json({ error: 'This round has already started.' }, { status: 409 })
  }

  // Transaction-integrity failures (migration 020) — these mean the RPC ran
  // and correctly REFUSED to begin the round because the data wasn't right.
  // The round has been rolled back to 'upcoming' automatically. Do NOT fall
  // back to direct inserts here — that fallback has none of these checks and
  // would silently re-introduce the exact problem the RPC just caught.
  if (rpcMsg.includes('HOLE_COUNT_MISMATCH')) {
    return NextResponse.json({
      error: 'Hole setup is incomplete or has duplicate hole numbers. Review the hole list and try again.',
      success: false,
    }, { status: 422 })
  }
  if (rpcMsg.includes('SCORECARD_COUNT_MISMATCH')) {
    return NextResponse.json({
      error: 'Scorecards could not be created for every player. Return to the trip and check player assignments before trying again.',
      success: false,
    }, { status: 422 })
  }
  if (rpcMsg.includes('UNMAPPED_PLAYING_GROUP')) {
    return NextResponse.json({
      error: 'One or more players are not assigned to a playing group. Assign every player to a group before beginning.',
      success: false,
    }, { status: 422 })
  }

  // Only fall back to direct inserts if the RPC itself doesn't exist yet
  // (migration 016/020 not applied) — a genuine "we can't use the safer path"
  // situation, not a validation failure from a safer path that just worked.
  const rpcMissing = rpcCode === '42883' || rpcMsg.includes('function public.begin_round') || rpcMsg.includes('does not exist')
  if (!rpcMissing) {
    return NextResponse.json({
      error: "We couldn't begin the round due to an unexpected error. Please try again or contact support.",
      success: false,
    }, { status: 500 })
  }

  console.warn('[start-round] begin_round() RPC not found — falling back to direct inserts (run migration 020)', { roundId, tripId })

  // ── Direct insert fallback (works even if migration 016 not applied) ───────
  // Holes upsert
  const holeRows = holeData.map((h: { hole_number: number; par: number; stroke_index: number }) => ({
    round_id: roundId, hole_number: h.hole_number, par: h.par, stroke_index: h.stroke_index,
  }))

  const { error: holesError } = await admin
    .from('holes')
    .upsert(holeRows, { onConflict: 'round_id,hole_number' })

  if (holesError) {
    console.error('[start-round] holes insert failed', {
      code: holesError.code, message: holesError.message,
      details: holesError.details, hint: holesError.hint,
      roundId,
    })
    const msg: string = holesError.message ?? ''
    if (msg.includes('does not exist') || msg.includes('relation "holes"')) {
      return NextResponse.json({
        error: 'The scoring tables are not set up in the database. Run migration 004 in Supabase SQL Editor.',
      }, { status: 500 })
    }
    return NextResponse.json({ error: "We couldn't save the hole data. Please try again." }, { status: 500 })
  }

  // Scorecards upsert
  const scorecardRows = scorecardData.map((s: { player_id: string; playing_handicap: number }) => ({
    round_id:         roundId,
    player_id:        s.player_id,
    playing_handicap: s.playing_handicap,
    status:           'active',
  }))

  const { error: cardsError } = await admin
    .from('scorecards')
    .upsert(scorecardRows, { onConflict: 'round_id,player_id' })

  if (cardsError) {
    console.error('[start-round] scorecards insert failed', {
      code: cardsError.code, message: cardsError.message,
      details: cardsError.details, hint: cardsError.hint,
      roundId, playerCount: scorecardRows.length,
    })
    // Holes already inserted but round status not changed — safe state to retry from
    return NextResponse.json({ error: "We couldn't create player scorecards. Please try again.", success: false }, { status: 500 })
  }

  // ── Verify the same invariants the RPC path checks (migration 020) ────────
  // This fallback isn't a single DB transaction, so this can't be a perfect
  // guarantee — but it stops the round from going 'active' on obviously
  // incomplete data, matching the "do not show Continue Scoring" requirement.
  const verifyRes = await admin
    .from('scorecards')
    .select('id, player_id', { count: 'exact' })
    .eq('round_id', roundId)
    .eq('status', 'active')

  const actualScorecardCount = verifyRes.data?.length ?? 0
  if (actualScorecardCount !== scorecardRows.length) {
    console.error('[start-round] fallback scorecard count mismatch — refusing to activate round', {
      roundId, expected: scorecardRows.length, actual: actualScorecardCount,
    })
    return NextResponse.json({
      error: 'Scorecards could not be created for every player. Return to the trip and check player assignments before trying again.',
      success: false,
    }, { status: 422 })
  }

  const membersForCheck = await admin
    .from('trip_members')
    .select('profile_id, group_id')
    .eq('trip_id', tripId)
  const groupByProfile = new Map<string, string | null>(
    (membersForCheck.data ?? []).map((m: { profile_id: string; group_id: string | null }) => [m.profile_id, m.group_id])
  )
  const unmappedCount = (verifyRes.data ?? []).filter((sc: { player_id: string }) => !groupByProfile.get(sc.player_id)).length
  if (unmappedCount > 0) {
    console.error('[start-round] fallback: players with no playing group', { roundId, unmappedCount })
    return NextResponse.json({
      error: 'One or more players are not assigned to a playing group. Assign every player to a group before beginning.',
      success: false,
    }, { status: 422 })
  }

  // Round status update — last, so any earlier failure leaves round as 'upcoming'
  const { error: statusError } = await admin
    .from('rounds')
    .update({ status: 'active' })
    .eq('id', roundId)

  if (statusError) {
    console.error('[start-round] round status update failed', {
      code: statusError.code, message: statusError.message,
      details: statusError.details, hint: statusError.hint,
      roundId,
    })
    return NextResponse.json({ error: "We couldn't begin the round. Please try again.", success: false }, { status: 500 })
  }

  const groupsProcessed = new Set([...groupByProfile.values()].filter(Boolean)).size

  console.log('[start-round] SUCCESS via direct inserts (RPC fallback)', {
    roundId, holesCreated: holeRows.length, scorecardsCreated: scorecardRows.length,
  })
  await autoGenerateMarkers(admin, tripId, roundId, round.score_capture_mode)

  return NextResponse.json({
    roundId, status: 'active',
    holesCreated:       holeRows.length,
    scorecardsCreated:  scorecardRows.length,
    expectedScorecards: scorecardRows.length,
    groupsProcessed,
    success: true,
  }, { status: 201 })
}
