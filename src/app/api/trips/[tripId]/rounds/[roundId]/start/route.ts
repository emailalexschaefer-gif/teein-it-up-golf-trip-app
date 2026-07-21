/**
 * POST /api/trips/[tripId]/rounds/[roundId]/start
 *
 * Organiser-only. Begins a round by calling the atomic begin_round() PostgreSQL
 * function via RPC. All three operations (holes, scorecards, status) execute
 * inside a single database transaction — a partial failure rolls everything back.
 *
 * Body:
 *   { holes: Array<{ hole_number: number; par: number; stroke_index: number }> }
 *
 * Returns:
 *   { roundId, status: "active", holesCreated, scorecardsCreated }
 *
 * Transaction safety:
 *   begin_round() is a SECURITY DEFINER PL/pgSQL function (migration 016).
 *   Postgres automatically rolls back on any exception inside the function.
 *   The round status is only set to "active" as the final step — if hole
 *   or scorecard creation fails, status remains "upcoming".
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
    return NextResponse.json({ error: 'Trip not found.' }, { status: 404 })
  }
  if (tripRes.data.organiser_id !== user.id) {
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
    return NextResponse.json({ error: 'Round not found in this trip.' }, { status: 404 })
  }

  const round = roundRes.data

  if (round.status === 'active') {
    return NextResponse.json({
      error: 'This round has already started.',
      roundId, status: 'active',
    }, { status: 409 })
  }
  if (round.status === 'completed') {
    return NextResponse.json({ error: 'This round has already been completed.' }, { status: 409 })
  }

  // ── Parse and validate hole data ───────────────────────────────────────────
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

  // Validate stroke indexes are unique and cover 1..holeCount
  const sortedSI = [...holes.map((h: { stroke_index: number }) => h.stroke_index)].sort((a: number, b: number) => a - b)
  const valid = sortedSI.every((si: number, i: number) => si === i + 1)
  if (!valid) {
    return NextResponse.json({
      error: `Each hole must have a unique stroke index from 1 to ${holeCount}.`,
    }, { status: 400 })
  }

  // ── Fetch playing groups and members ───────────────────────────────────────
  const groupsRes = await admin
    .from('trip_groups')
    .select('id, name')
    .eq('trip_id', tripId)

  if (!groupsRes.data || groupsRes.data.length === 0) {
    return NextResponse.json({
      error: 'Assign every player to a playing group before beginning.',
    }, { status: 422 })
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

  if (assignedMembers.length === 0) {
    return NextResponse.json({
      error: 'No players are assigned to groups. Assign players before beginning.',
    }, { status: 422 })
  }

  // Every player must have a usable handicap
  const missingHcp = assignedMembers.filter(m =>
    resolvePlayingHandicap(m.playing_handicap, m.profiles?.handicap) === null
  )
  if (missingHcp.length > 0) {
    const names = missingHcp.map(m => m.profiles?.full_name ?? 'Unknown').join(', ')
    return NextResponse.json({
      error: `Every player must have a playing handicap before the round can begin. Missing for: ${names}.`,
    }, { status: 422 })
  }

  // ── Build RPC arguments ────────────────────────────────────────────────────
  const holeData = holes.map((h: { hole_number: number; par: number; stroke_index: number }) => ({
    hole_number: h.hole_number, par: h.par, stroke_index: h.stroke_index,
  }))

  const scorecardData = assignedMembers.map((m: typeof assignedMembers[0]) => ({
    player_id:        m.profile_id,
    playing_handicap: resolvePlayingHandicap(m.playing_handicap, m.profiles?.handicap) ?? 0,
  }))

  // ── Call atomic begin_round() via RPC ─────────────────────────────────────
  // All three operations (holes, scorecards, round status) execute inside
  // a single PostgreSQL transaction. If any step fails, everything rolls back.
  const { data: rpcResult, error: rpcError } = await admin.rpc('begin_round', {
    p_round_id:      roundId,
    p_hole_data:     holeData,
    p_scorecard_data: scorecardData,
  })

  if (rpcError) {
    const msg: string = rpcError.message ?? ''
    console.error('[start-round] begin_round RPC failed', { msg, roundId })

    // Translate DB errors into friendly messages
    if (msg.includes('ROUND_NOT_UPCOMING')) {
      return NextResponse.json({ error: 'This round has already started.' }, { status: 409 })
    }
    return NextResponse.json({
      error: "We couldn't begin the round. Please try again.",
    }, { status: 500 })
  }

  const result = rpcResult as {
    round_id: string; status: string
    holes_created: number; scorecards_created: number
  }

  console.log('[start-round] SUCCESS via begin_round()', result)

  return NextResponse.json({
    roundId:          result.round_id,
    status:           result.status,
    holesCreated:     result.holes_created,
    scorecardsCreated: result.scorecards_created,
  }, { status: 201 })
}
