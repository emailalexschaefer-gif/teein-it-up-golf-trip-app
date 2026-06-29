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

  // Verify scorecard ownership
  const { data: scorecard } = await supabase
    .from('scorecards')
    .select('id, player_id, status, round_id')
    .eq('id', scorecard_id)
    .single()

  if (!scorecard) return NextResponse.json({ error: 'Scorecard not found' }, { status: 422 })
  if (scorecard.player_id !== user.id) return NextResponse.json({ error: 'Not your scorecard' }, { status: 403 })
  if (scorecard.status !== 'active') return NextResponse.json({ error: 'Scorecard not active' }, { status: 422 })

  // Verify round is active
  const { data: round } = await supabase
    .from('rounds')
    .select('id, status, trip_id')
    .eq('id', scorecard.round_id)
    .single()

  if (!round || round.status !== 'active') {
    return NextResponse.json({ error: 'Round is not active' }, { status: 422 })
  }

  // Verify trip membership
  const { data: membership } = await supabase
    .from('trip_members')
    .select('role')
    .eq('trip_id', round.trip_id)
    .eq('profile_id', user.id)
    .single()

  if (!membership) return NextResponse.json({ error: 'Not a trip member' }, { status: 403 })

  // Verify hole belongs to round
  const { data: hole } = await supabase
    .from('holes')
    .select('id')
    .eq('id', hole_id)
    .eq('round_id', scorecard.round_id)
    .single()

  if (!hole) return NextResponse.json({ error: 'Hole not found in this round' }, { status: 422 })

  // Upsert — idempotent on client_id
  const { data: entry, error: insertError } = await supabase
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
