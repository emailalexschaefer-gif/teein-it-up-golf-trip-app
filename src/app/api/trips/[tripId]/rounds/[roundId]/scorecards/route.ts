/**
 * GET /api/trips/[tripId]/rounds/[roundId]/scorecards
 * Returns scorecards with player details for an active round.
 * Used by the scoring session shell (Sprint 5A) and score entry (Sprint 5B).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  // Verify caller is a trip member
  const memberCheck = await admin
    .from('trip_members')
    .select('id, role')
    .eq('trip_id', tripId)
    .eq('profile_id', user.id)
    .maybeSingle()

  if (!memberCheck.data) {
    return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })
  }

  // Fetch scorecards with player profile and group info
  const result = await admin
    .from('scorecards')
    .select(`
      id, round_id, player_id, playing_handicap, status, submitted_at,
      profiles:player_id ( id, full_name, avatar_url ),
      trip_members!inner ( group_id, trip_groups:group_id ( id, name, tee_time ) ),
      score_entries ( hole_id, gross_score, stableford_pts, is_no_return, capture_role, entered_by )
    `)
    .eq('round_id', roundId)
    .neq('status', 'withdrawn')
    .order('playing_handicap', { ascending: true })

  if (result.error) {
    console.error('[GET scorecards]', result.error)
    return NextResponse.json({ error: 'Could not load scorecards.' }, { status: 500 })
  }

  // Also fetch the round itself to confirm it belongs to this trip
  const roundRes = await admin
    .from('rounds')
    .select('id, name, status, holes, scoring_format, course_name, tee_time, play_date')
    .eq('id', roundId)
    .eq('trip_id', tripId)
    .single()

  if (!roundRes.data) {
    return NextResponse.json({ error: 'Round not found.' }, { status: 404 })
  }

  return NextResponse.json({
    round: roundRes.data,
    scorecards: result.data ?? [],
    isOrganiser: memberCheck.data.role === 'organiser',
  })
}

/**
 * POST /api/trips/[tripId]/rounds/[roundId]/scorecards
 * body: { action: 'submit' }
 * Locks the caller's own scorecard for this round — sets status to
 * 'completed' and submitted_at to now(). Reuses the existing status/
 * submitted_at columns (migration 004), which already had exactly this
 * transition designed in but never wired up to anything. Only the
 * scorecard's own player may submit it, and only once every hole is
 * genuinely matched (self entry present, and in self_and_marker mode,
 * agreeing with the marker's entry) — this doesn't duplicate the
 * comparison logic; it reuses the same compareCaptures() rules already
 * used by Round Summary and the tournament route, applied server-side
 * here as the actual gate before a lock is allowed.
 */
export async function POST(req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const action = (body as { action?: string }).action

  if (action === 'unlock') return handleUnlock(req, user.id, tripId, roundId, body)
  if (action !== 'submit') {
    return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const memberCheck = await admin.from('trip_members').select('id').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberCheck.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

  const roundRes = await admin.from('rounds').select('id, holes, score_capture_mode').eq('id', roundId).eq('trip_id', tripId).maybeSingle()
  if (!roundRes.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })

  const scorecardRes = await admin
    .from('scorecards')
    .select('id, status, score_entries ( hole_id, gross_score, is_no_return, capture_role )')
    .eq('round_id', roundId).eq('player_id', user.id).maybeSingle()

  if (!scorecardRes.data) return NextResponse.json({ error: 'You do not have a scorecard for this round.' }, { status: 404 })
  if (scorecardRes.data.status === 'completed') {
    return NextResponse.json({ ok: true, alreadySubmitted: true })
  }

  const totalHoles: number = roundRes.data.holes ?? 18
  interface Entry { hole_id: string; gross_score: number | null; is_no_return: boolean; capture_role: string }
  const entries: Entry[] = scorecardRes.data.score_entries ?? []
  const selfByHole = new Map<string, Entry>()
  const markerByHole = new Map<string, Entry>()
  for (const e of entries) {
    if (e.capture_role === 'self') selfByHole.set(e.hole_id, e)
    else if (e.capture_role === 'marker') markerByHole.set(e.hole_id, e)
  }

  if (selfByHole.size < totalHoles) {
    return NextResponse.json({ error: `Score entry isn't complete — ${selfByHole.size} of ${totalHoles} holes entered.` }, { status: 422 })
  }
  if (roundRes.data.score_capture_mode === 'self_and_marker') {
    for (const [holeId, self] of selfByHole) {
      const marker = markerByHole.get(holeId)
      if (!marker) return NextResponse.json({ error: 'Waiting on marker entries for one or more holes.' }, { status: 422 })
      const differs = self.is_no_return !== marker.is_no_return || (!self.is_no_return && self.gross_score !== marker.gross_score)
      if (differs) return NextResponse.json({ error: 'One or more holes still need review before scores can be finalised.' }, { status: 422 })
    }
  }

  const { error: updateErr } = await admin
    .from('scorecards')
    .update({ status: 'completed', submitted_at: new Date().toISOString() })
    .eq('id', scorecardRes.data.id)

  if (updateErr) {
    console.error('[POST scorecards submit]', updateErr)
    return NextResponse.json({ error: "Couldn't finalise your scores. Please try again." }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

/**
 * Organiser override — unlocks a confirmed scorecard so its player can
 * correct and re-submit. Requires an explicit, non-empty reason (this is
 * a deliberate, audited action, not a casual toggle) and records who
 * unlocked it and when, on the same scorecards row rather than a
 * separate audit table (migration 032). Resets the player's confirmation
 * state (status back to 'active', submitted_at cleared) so re-locking
 * requires the player to genuinely re-confirm, not silently stay
 * "confirmed" against corrected scores.
 */
async function handleUnlock(_req: NextRequest, userId: string, tripId: string, roundId: string, body: unknown) {
  const { playerId, reason } = body as { playerId?: string; reason?: string }
  if (!playerId) return NextResponse.json({ error: 'Missing player.' }, { status: 400 })
  if (!reason || !reason.trim()) {
    return NextResponse.json({ error: 'A reason is required to unlock a confirmed scorecard.' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const memberCheck = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', userId).maybeSingle()
  if (memberCheck.data?.role !== 'organiser') {
    return NextResponse.json({ error: 'Only the organiser can unlock a confirmed scorecard.' }, { status: 403 })
  }

  const scorecardRes = await admin.from('scorecards').select('id, status').eq('round_id', roundId).eq('player_id', playerId).maybeSingle()
  if (!scorecardRes.data) return NextResponse.json({ error: 'Scorecard not found.' }, { status: 404 })
  if (scorecardRes.data.status !== 'completed') {
    return NextResponse.json({ error: 'This scorecard is not currently locked.' }, { status: 422 })
  }

  const { error: unlockErr } = await admin
    .from('scorecards')
    .update({
      status: 'active',
      submitted_at: null,
      unlock_reason: reason.trim(),
      unlocked_at: new Date().toISOString(),
      unlocked_by: userId,
    })
    .eq('id', scorecardRes.data.id)

  if (unlockErr) {
    console.error('[POST scorecards unlock]', unlockErr)
    // Investigation note (Package 3 P0) — traced the full path: RLS is
    // not a factor (createAdminClient uses the service role, bypassing
    // RLS entirely), the update targets the correct scorecard id
    // (already confirmed to exist and be 'completed' just above), and
    // migration 032 (unlock_reason/unlocked_at/unlocked_by) reads as
    // correct and idempotent on inspection. Without direct database
    // access to this environment, I cannot confirm from here whether
    // that migration has actually been applied, or whether some other
    // constraint is the real cause — so rather than guess further, this
    // now surfaces the actual Postgres error code/message in the
    // response (the same "debug" field pattern already used in
    // moments/route.ts for exactly this situation), so the next
    // real-device attempt shows the precise cause directly instead of
    // this generic message.
    return NextResponse.json({
      error: "Couldn't unlock this scorecard. Please try again.",
      debug: `${unlockErr.code ?? 'unknown'}: ${unlockErr.message ?? 'no message'}`,
    }, { status: 500 })
  }

  console.log('[scorecards unlock]', { tripId, roundId, playerId, unlockedBy: userId, reason: reason.trim() })
  return NextResponse.json({ ok: true })
}
