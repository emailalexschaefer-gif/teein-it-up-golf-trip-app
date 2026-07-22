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
    .select('id, status, holes, name, trip_id')
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
    const result = rpcResult as { round_id: string; status: string; holes_created: number; scorecards_created: number }
    console.log('[start-round] SUCCESS via RPC', result)
    return NextResponse.json({
      roundId: result.round_id, status: result.status,
      holesCreated: result.holes_created, scorecardsCreated: result.scorecards_created,
    }, { status: 201 })
  }

  // Log the RPC error for diagnosis
  const rpcMsg: string = rpcError?.message ?? ''
  const rpcCode: string = rpcError?.code ?? ''
  console.warn('[start-round] RPC failed, attempting direct insert fallback', {
    rpcCode, rpcMsg,
    details: rpcError?.details ?? null,
    hint:    rpcError?.hint    ?? null,
    roundId, tripId, userId: user.id,
  })

  // Known fatal errors — don't attempt fallback
  if (rpcMsg.includes('ROUND_NOT_UPCOMING')) {
    return NextResponse.json({ error: 'This round has already started.' }, { status: 409 })
  }

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
    return NextResponse.json({ error: "We couldn't create player scorecards. Please try again." }, { status: 500 })
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
    return NextResponse.json({ error: "We couldn't begin the round. Please try again." }, { status: 500 })
  }

  console.log('[start-round] SUCCESS via direct inserts (RPC fallback)', {
    roundId, holesCreated: holeRows.length, scorecardsCreated: scorecardRows.length,
  })

  return NextResponse.json({
    roundId, status: 'active',
    holesCreated:     holeRows.length,
    scorecardsCreated: scorecardRows.length,
  }, { status: 201 })
}
