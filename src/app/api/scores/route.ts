import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isCaptureAllowed } from '@/lib/scoring/captureMode'
import { decideScoreWrite } from '@/lib/scoring/scoreWriteDecision'
import { isIdenticalRecordedResend } from '@/lib/scoring/recordedResend'
import { z } from 'zod'
import { ambroseLegacyScoreBlock } from '@/lib/ambrose/legacyScoreGuard'

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

const LOCKED_MESSAGE = 'This score was set by the organiser and is locked'
const ROW_COLUMNS = 'id, scorecard_id, hole_id, capture_role, gross_score, is_no_return, client_id, entered_at, admin_overridden'

/**
 * 18 Oct field test -- a score the server ALREADY holds, re-sent by the same
 * user after its scorecard/round has closed.
 *
 * Root cause of the "Scorecard not active" refusals kept on players' phones:
 * if a phone loses the acknowledgement for a save that did land (the airplane
 * -mode tests do exactly this) it re-sends later. The active-card / active-
 * round gates run BEFORE the duplicate check, so once the card was submitted
 * or the round closed, the harmless re-send was answered 422 and parked as
 * "needs review" although the server holds that exact score.
 *
 * Only an IDENTICAL record is acknowledged: same client_id, same card / hole /
 * role, same value, entered by this user. It writes nothing. Any other write
 * to a closed card is still refused.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findAlreadyRecordedResend(db: any, userId: string, req: {
  client_id: string; scorecard_id: string; hole_id: string; capture_role: 'self' | 'marker'
  gross_score: number | null; is_no_return: boolean
}) {
  const res = await db
    .from('score_entries')
    .select(`${ROW_COLUMNS}, entered_by`)
    .eq('client_id', req.client_id)
    .maybeSingle()
  const row = res?.data
  if (!isIdenticalRecordedResend(row, req, userId)) return null
  const { entered_by: _enteredBy, ...ack } = row
  void _enteredBy
  return ack
}

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
  if (scorecard.status !== 'active') {
    const already = await findAlreadyRecordedResend(db, user.id, { client_id, scorecard_id, hole_id, capture_role, gross_score, is_no_return })
    if (already) return NextResponse.json({ ...already, message: 'Already recorded', conflict: true, duplicate: true }, { status: 200 })
    return NextResponse.json({ error: 'Scorecard not active' }, { status: 422 })
  }

  // V8 Ambrose: an Ambrose round takes TEAM scores only (flagged; no-op otherwise).
  const ambroseBlock = await ambroseLegacyScoreBlock(db, scorecard.round_id)
  if (ambroseBlock) return NextResponse.json(ambroseBlock.body, { status: ambroseBlock.status })

  const roundResult = await db
    .from('rounds')
    .select('id, status, trip_id, score_capture_mode')
    .eq('id', scorecard.round_id)
    .single()

  const round = roundResult?.data ?? null
  if (!round || round.status !== 'active') {
    const already = await findAlreadyRecordedResend(db, user.id, { client_id, scorecard_id, hole_id, capture_role, gross_score, is_no_return })
    if (already) return NextResponse.json({ ...already, message: 'Already recorded', conflict: true, duplicate: true }, { status: 200 })
    return NextResponse.json({ error: 'Round is not active' }, { status: 422 })
  }

  const memberResult = await db
    .from('trip_members')
    .select('role, group_id')
    .eq('trip_id', round.trip_id)
    .eq('profile_id', user.id)
    .maybeSingle()

  if (!memberResult?.data) return NextResponse.json({ error: 'Not an event member' }, { status: 403 })

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

  // ── Ordering-safe write (Phase B, D1) ────────────────────────────────────
  // The (scorecard, hole, role) row is the real target. The value with the
  // LATEST entered_at wins, regardless of the order requests reach the
  // server (see decideScoreWrite). That makes a retry after a timeout, a
  // lost acknowledgement, or a late-arriving old request all safe: an
  // identical resend is a no-op, an older value can never overwrite a newer
  // correction, and a newer correction is never silently discarded.
  const incomingEnteredAt = entered_at ?? new Date().toISOString()

  // client_id is globally UNIQUE. If it already belongs to a DIFFERENT
  // record, this request can never be satisfied — reject it rather than
  // let the unique constraint surface as a generic 500 the client would
  // retry forever.
  const existingByClientId = await db
    .from('score_entries')
    .select('id, scorecard_id, hole_id, capture_role')
    .eq('client_id', client_id)
    .maybeSingle()

  if (
    existingByClientId?.data &&
    (existingByClientId.data.scorecard_id !== scorecard_id ||
      existingByClientId.data.hole_id !== hole_id ||
      existingByClientId.data.capture_role !== capture_role)
  ) {
    return NextResponse.json({ error: 'client_id already used for a different score' }, { status: 409 })
  }

  const existingForRole = await db
    .from('score_entries')
    .select(ROW_COLUMNS)
    .eq('scorecard_id', scorecard_id)
    .eq('hole_id', hole_id)
    .eq('capture_role', capture_role)
    .maybeSingle()

  const decision = decideScoreWrite(existingForRole?.data ?? null, {
    client_id, entered_at: incomingEnteredAt, gross_score, is_no_return,
  })

  // Acknowledge without writing. The body always carries the stored row so
  // the client can verify WHAT is on the server before it marks anything
  // synced (see src/lib/db/scoreAck.ts). `conflict: true` is kept on
  // duplicates for clients that predate Phase B.
  if (decision.action === 'duplicate') {
    return NextResponse.json({ ...existingForRole.data, message: 'Already recorded', conflict: true, duplicate: true }, { status: 200 })
  }
  if (decision.action === 'stale') {
    return NextResponse.json({ ...existingForRole.data, message: 'A newer score is already recorded', stale: true }, { status: 200 })
  }
  // Organiser-verified score: authoritative, never overwritten from here —
  // not by a delayed offline submission, not by the organiser's own normal
  // scoring screen. `stale: true` is kept so the client treats it as
  // superseded; `locked: true` says why.
  if (decision.action === 'locked') {
    return NextResponse.json({ ...existingForRole.data, message: LOCKED_MESSAGE, stale: true, locked: true }, { status: 200 })
  }

  const payload = {
    scorecard_id, hole_id, capture_role, gross_score, is_no_return,
    entered_by: user.id,
    entered_at: incomingEnteredAt,
    client_id,
  }

  if (decision.action === 'update') {
    // The `entered_at <= incoming` condition is part of the UPDATE itself, so
    // two concurrent requests cannot both pass the check above and then
    // apply out of order. Zero rows updated means a newer value won the race.
    const updated = await db
      .from('score_entries')
      .update(payload)
      .eq('id', decision.rowId)
      .lte('entered_at', incomingEnteredAt)
      // An organiser override landing between the read above and this write
      // must win: the guard is part of the UPDATE, so it cannot be raced.
      .eq('admin_overridden', false)
      .select(ROW_COLUMNS)

    if (updated.error) {
      console.error('[score] save failed', updated.error)
      return NextResponse.json({ error: 'Failed to save score' }, { status: 500 })
    }
    const updatedRow = Array.isArray(updated.data) ? updated.data[0] : null
    if (!updatedRow) {
      const current = await db.from('score_entries').select(ROW_COLUMNS).eq('id', decision.rowId).maybeSingle()
      if (!current?.data) return NextResponse.json({ error: 'Failed to save score' }, { status: 500 })
      if (current.data.admin_overridden === true) {
        return NextResponse.json({ ...current.data, message: LOCKED_MESSAGE, stale: true, locked: true }, { status: 200 })
      }
      return NextResponse.json({ ...current.data, message: 'A newer score is already recorded', stale: true }, { status: 200 })
    }
    return NextResponse.json(updatedRow, { status: 201 })
  }

  const inserted = await db
    .from('score_entries')
    .insert(payload)
    .select(ROW_COLUMNS)
    .single()

  if (inserted.error || !inserted.data) {
    console.error('[score] save failed', inserted.error)
    return NextResponse.json({ error: 'Failed to save score' }, { status: 500 })
  }

  return NextResponse.json(inserted.data, { status: 201 })
}
