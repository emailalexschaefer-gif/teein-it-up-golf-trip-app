import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const ScoreSchema = z.object({
  scorecard_id: z.string().uuid(),
  hole_id:      z.string().uuid(),
  gross_score:  z.number().int().min(1).max(20),
  is_no_return: z.boolean().default(false),
  client_id:    z.string().uuid(),
  entered_at:   z.string().datetime().optional(),
})

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

  const { scorecard_id, hole_id, gross_score, is_no_return, client_id, entered_at } = parsed.data

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
    .select('id, status, trip_id')
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

  // ── Playing-group scoring permission ─────────────────────────────────────
  // Anyone may score their own card. Otherwise the caller must be the trip
  // organiser, or share a playing group (trip_groups) with the scorecard's
  // player. Mirrors the same_playing_group() DB function in migration 017,
  // checked here too so we return a clean 403 rather than relying on RLS.
  const isOwnCard = scorecard.player_id === user.id
  const isOrganiser = memberResult.data.role === 'organiser'
  let isSameGroup = false
  if (!isOwnCard && !isOrganiser) {
    const targetMemberResult = await db
      .from('trip_members')
      .select('group_id')
      .eq('trip_id', round.trip_id)
      .eq('profile_id', scorecard.player_id)
      .maybeSingle()
    const targetGroupId = targetMemberResult?.data?.group_id ?? null
    isSameGroup = !!targetGroupId && targetGroupId === memberResult.data.group_id
  }

  if (!isOwnCard && !isOrganiser && !isSameGroup) {
    return NextResponse.json({ error: 'You can only score for your own playing group' }, { status: 403 })
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

  // ── Real upsert target: (scorecard_id, hole_id) ──────────────────────────
  // This is what makes editing a previously-scored hole actually work,
  // instead of colliding with the UNIQUE(scorecard_id, hole_id) constraint
  // and returning a false 409 on every re-score.
  const existingForHole = await db
    .from('score_entries')
    .select('id')
    .eq('scorecard_id', scorecard_id)
    .eq('hole_id', hole_id)
    .maybeSingle()

  const payload = {
    scorecard_id, hole_id, gross_score, is_no_return,
    entered_by: user.id,
    entered_at: entered_at ?? new Date().toISOString(),
    client_id,
  }

  let entry, dbError
  if (existingForHole?.data) {
    ({ data: entry, error: dbError } = await db
      .from('score_entries')
      .update(payload)
      .eq('id', existingForHole.data.id)
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
