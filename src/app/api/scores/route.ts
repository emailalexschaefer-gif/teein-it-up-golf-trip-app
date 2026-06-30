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
  if (scorecard.player_id !== user.id) return NextResponse.json({ error: 'Not your scorecard' }, { status: 403 })
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
    .select('role')
    .eq('trip_id', round.trip_id)
    .eq('profile_id', user.id)
    .maybeSingle()

  if (!memberResult?.data) return NextResponse.json({ error: 'Not a trip member' }, { status: 403 })

  const holeResult = await db
    .from('holes')
    .select('id')
    .eq('id', hole_id)
    .eq('round_id', scorecard.round_id)
    .maybeSingle()

  if (!holeResult?.data) return NextResponse.json({ error: 'Hole not found in this round' }, { status: 422 })

  const { data: entry, error: insertError } = await db
    .from('score_entries')
    .upsert(
      {
        scorecard_id, hole_id, gross_score, is_no_return,
        entered_by: user.id,
        entered_at: entered_at ?? new Date().toISOString(),
        client_id,
      },
      { onConflict: 'client_id' }
    )
    .select()
    .single()

  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json({ message: 'Already recorded', conflict: true }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to save score' }, { status: 500 })
  }

  return NextResponse.json(entry, { status: 201 })
}
