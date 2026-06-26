// ─────────────────────────────────────────────────────────────────────────────
// POST /api/scores
// Validates and writes a score entry to the database.
// All score writes go through here — never directly from client to Supabase.
//
// Returns:
//   201 — score created
//   409 — already exists (idempotent: same client_id) — treat as success
//   400 — validation error
//   401 — not authenticated
//   403 — not a member of this trip
//   422 — business rule violation (round not active, invalid score, etc.)
//   500 — server error
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const ScoreEntrySchema = z.object({
  scorecard_id: z.string().uuid(),
  hole_id:      z.string().uuid(),
  gross_score:  z.number().int().min(1).max(20),
  is_no_return: z.boolean().default(false),
  client_id:    z.string().uuid(),
  entered_at:   z.string().datetime().optional(),
})

export async function POST(request: Request) {
  const supabase = createClient()

  // ── 1. Auth check ─────────────────────────────────────────────────────────
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // ── 2. Parse and validate body ────────────────────────────────────────────
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = ScoreEntrySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const { scorecard_id, hole_id, gross_score, is_no_return, client_id, entered_at } =
    parsed.data

  // ── 3. Load scorecard and verify ownership ────────────────────────────────
  const { data: scorecard, error: scError } = await supabase
    .from('scorecards')
    .select('id, player_id, status, round_id')
    .eq('id', scorecard_id)
    .single()

  if (scError || !scorecard) {
    return NextResponse.json({ error: 'Scorecard not found' }, { status: 422 })
  }

  // Only the player whose scorecard this is can enter their score
  // (organisers can correct via a separate endpoint — Sprint 5)
  if (scorecard.player_id !== user.id) {
    return NextResponse.json(
      { error: 'You can only enter scores on your own scorecard' },
      { status: 403 }
    )
  }

  if (scorecard.status !== 'active') {
    return NextResponse.json(
      { error: 'Scorecard is not active' },
      { status: 422 }
    )
  }

  // ── 4. Verify the round is active ─────────────────────────────────────────
  const { data: round, error: roundError } = await supabase
    .from('rounds')
    .select('id, status, trip_id')
    .eq('id', scorecard.round_id)
    .single()

  if (roundError || !round) {
    return NextResponse.json({ error: 'Round not found' }, { status: 422 })
  }

  if (round.status !== 'active') {
    return NextResponse.json(
      { error: 'Round is not currently active' },
      { status: 422 }
    )
  }

  // ── 5. Verify the user is a member of this trip ───────────────────────────
  const { data: membership } = await supabase
    .from('trip_members')
    .select('role')
    .eq('trip_id', round.trip_id)
    .eq('profile_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json(
      { error: 'Not a member of this trip' },
      { status: 403 }
    )
  }

  // ── 6. Verify hole belongs to this round ──────────────────────────────────
  const { data: hole, error: holeError } = await supabase
    .from('holes')
    .select('id')
    .eq('id', hole_id)
    .eq('round_id', scorecard.round_id)
    .single()

  if (holeError || !hole) {
    return NextResponse.json({ error: 'Hole not found in this round' }, { status: 422 })
  }

  // ── 7. Upsert the score entry (idempotent on client_id) ───────────────────
  const { data: entry, error: insertError } = await supabase
    .from('score_entries')
    .upsert(
      {
        scorecard_id,
        hole_id,
        gross_score,
        is_no_return,
        entered_by: user.id,
        entered_at: entered_at ?? new Date().toISOString(),
        client_id,
      },
      {
        onConflict: 'client_id',
        ignoreDuplicates: false,
      }
    )
    .select()
    .single()

  if (insertError) {
    // Unique constraint on (scorecard_id, hole_id) — already exists for this hole
    if (insertError.code === '23505') {
      return NextResponse.json(
        { message: 'Score already recorded for this hole', conflict: true },
        { status: 409 }
      )
    }

    console.error('[POST /api/scores]', insertError)
    return NextResponse.json({ error: 'Failed to save score' }, { status: 500 })
  }

  return NextResponse.json(entry, { status: 201 })
}
