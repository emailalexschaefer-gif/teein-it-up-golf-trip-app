import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isCaptureAllowed } from '@/lib/scoring/captureMode'
import { z } from 'zod'

const ScoreSchema = z.object({
  scorecard_id: z.string().uuid(),
  hole_id:      z.string().uuid(),
  capture_role: z.enum(['self', 'marker']).default('self'),
  gross_score:  z.number().int().min(1).max(20).nullable(),
  is_no_return: z.boolean().default(false),
  client_id:    z.string().uuid(),
  entered_at:   z.string().datetime().optional(),
}).refine(
  (v) => (v.is_no_return && v.gross_score === null) || (!v.is_no_return && v.gross_score !== null),
  { message: 'gross_score must be null for a pick-up, and a number 1-20 otherwise' }
)

export async function POST(request: Request) {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = supabase

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = ScoreSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 })
  }

  const { scorecard_id, hole_id, capture_role, gross_score, is_no_return, client_id, entered_at } = parsed.data

  const scorecardResult = await db
    .from('scorecards')
    .select('id, player_id, status, round_id')
    .eq('id', scorecard_id)
    .single()

  const scorecard = scorecardResult?.data ?? null
  if (!scorecard) return NextResponse.json({ error: 'Scorecard not found' }, { status: 422 })
  if (scorecard.status !== 'active') return NextResponse.json({ error: 'Scorecard not active' }, { status: 422 })

  const roundResult = await db
    .from('rounds')
    .select('id, status, trip_id, score_capture_mode')
    .eq('id', scorecard.round_id)
    .single()

  const round = roundResult?.data ?? null
  if (!round || round.status !== 'active') {
    return NextResponse.json({ error: 'Round is not active' }, { status: 422 })
  }

  const memberResult = await db
    .from('trip_members')
    .select('role, group_id')
    .eq('trip_id', round.trip_id)
    .eq('profile_id', user.id)
    .maybeSingle()

  if (!memberResult?.data) return NextResponse.json({ error: 'Not a trip member' }, { status: 403 })

  const isOrganiser = memberResult.data.role === 'organiser'
  const isOwnCard = scorecard.player_id === user.id

  // ── Score-capture permission ────────────────────────────────────────────
  // Delegates to the same pure function the tests cover (captureMode.ts) —
  // fixes a real bug: this route used to look up round_markers for ANY
  // marker-role write without first checking the round's mode, so
  // 'individual' mode (which should have no marker concept at all) would
  // still honour a stray marker-role write if one somehow existed. Now
  // 'individual' mode structurally never even reaches the round_markers
  // lookup for a marker-role request.
  let isSamePlayingGroup: boolean | undefined
  let isAssignedMarker: boolean | undefined

  if (!isOrganiser && round.score_capture_mode === 'group_scorer' && capture_role === 'self' && !isOwnCard) {
    const targetMemberResult = await db
      .from('trip_members')
      .select('group_id')
      .eq('trip_id', round.trip_id)
      .eq('profile_id', scorecard.player_id)
      .maybeSingle()
    const targetGroupId = targetMemberResult?.data?.group_id ?? null
    isSamePlayingGroup = !!targetGroupId && targetGroupId === memberResult.data.group_id
  }

  if (!isOrganiser && round.score_capture_mode === 'self_and_marker' && capture_role === 'marker') {
    const markerResult = await db
      .from('round_markers')
      .select('id')
      .eq('round_id', scorecard.round_id)
      .eq('player_id', scorecard.player_id)
      .eq('marker_player_id', user.id)
      .maybeSingle()
    isAssignedMarker = !!markerResult?.data
  }

  const allowed = isCaptureAllowed({
    mode: round.score_capture_mode,
    captureRole: capture_role,
    isOwnCard,
    isOrganiser,
    isSamePlayingGroup,
    isAssignedMarker,
  })

  if (!allowed) {
    return NextResponse.json({
      error: capture_role === 'marker'
        ? (round.score_capture_mode === 'individual'
          ? 'This round does not use marker scoring.'
          : 'You are not the assigned marker for this player.')
        : 'You can only enter your own score.',
    }, { status: 403 })
  }

  const holeResult = await db
    .from('holes')
    .select('id')
    .eq('id', hole_id)
    .eq('round_id', scorecard.round_id)
    .maybeSingle()

  if (!holeResult?.data) return NextResponse.json({ error: 'Hole not found in this round' }, { status: 422 })

  // ── Idempotency: has this exact submission (by client_id) already landed? ──
  const existingByClientId = await db
    .from('score_entries')
    .select('id')
    .eq('client_id', client_id)
    .maybeSingle()

  if (existingByClientId?.data) {
    return NextResponse.json({ message: 'Already recorded', conflict: true }, { status: 200 })
  }

  // ── Real upsert target: (scorecard_id, hole_id, capture_role) ────────────
  // A self entry and a marker entry for the same hole are independent
  // records — this is what makes them never collide with each other, while
  // re-scoring the SAME role for the same hole still correctly updates
  // rather than duplicating.
  const existingForRole = await db
    .from('score_entries')
    .select('id')
    .eq('scorecard_id', scorecard_id)
    .eq('hole_id', hole_id)
    .eq('capture_role', capture_role)
    .maybeSingle()

  const payload = {
    scorecard_id, hole_id, capture_role, gross_score, is_no_return,
    entered_by: user.id,
    entered_at: entered_at ?? new Date().toISOString(),
    client_id,
  }

  let entry, dbError
  if (existingForRole?.data) {
    ({ data: entry, error: dbError } = await db
      .from('score_entries')
      .update(payload)
      .eq('id', existingForRole.data.id)
      .select()
      .single())
  } else {
    ({ data: entry, error: dbError } = await db
      .from('score_entries')
      .insert(payload)
      .select()
      .single())
  }

  if (dbError) {
    console.error('[score] save failed', dbError)
    return NextResponse.json({ error: 'Failed to save score' }, { status: 500 })
  }

  return NextResponse.json(entry, { status: 201 })
}
