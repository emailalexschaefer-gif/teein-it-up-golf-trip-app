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
  if ((body as { action?: string }).action !== 'submit') {
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
