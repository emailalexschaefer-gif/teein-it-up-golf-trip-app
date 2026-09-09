import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

/**
 * GET/POST /api/trips/[tripId]/rounds/[roundId]/practice-stats
 *
 * Practice V2 (8 Sep), items 2-3 — the persistence layer behind
 * per-hole Practice stat capture. Reads/writes practice_hole_stats
 * (migration 079) only — never touches score_entries, never touches
 * anything Event-scoped. Idempotent by construction:
 * ON CONFLICT (scorecard_id, hole_number) DO UPDATE, matching the
 * table's own UNIQUE constraint — "one row/state per golfer +
 * Practice round + hole" is enforced by the database, not merely
 * assumed by this route.
 */

const StatUpsertSchema = z.object({
  holeNumber: z.number().int().min(1).max(18),
  fairwayHit: z.boolean().nullable().optional(),
  gir: z.boolean().nullable().optional(),
  putts: z.number().int().min(0).max(20).nullable().optional(),
})

async function resolveOwnScorecard(admin: ReturnType<typeof createAdminClient>, roundId: string, userId: string) {
  const res = await admin.from('scorecards').select('id').eq('round_id', roundId).eq('player_id', userId).maybeSingle()
  return res.data?.id ?? null
}

export async function GET(_req: Request, { params }: RouteProps) {
  const { roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()
  const scorecardId = await resolveOwnScorecard(admin, roundId, user.id)
  if (!scorecardId) return NextResponse.json({ stats: [] })

  const res = await admin.from('practice_hole_stats')
    .select('hole_number, fairway_hit, gir, putts')
    .eq('scorecard_id', scorecardId)

  return NextResponse.json({ stats: res.data ?? [] })
}

export async function POST(request: Request, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }) }
  const parsed = StatUpsertSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed.' }, { status: 400 })
  const { holeNumber, fairwayHit, gir, putts } = parsed.data

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  // Practice V2, item 13 — "do not regress current working flows."
  // This route only ever writes Practice-round rows: confirmed
  // explicitly here, not assumed from the URL alone, since nothing
  // stops a normal Event round's roundId being passed to this route by
  // mistake elsewhere. An Event round's stat write is refused outright
  // rather than silently accepted.
  const tripRes = await admin.from('trips').select('is_practice').eq('id', tripId).maybeSingle()
  if (tripRes.data?.is_practice !== true) {
    return NextResponse.json({ error: 'Practice stats can only be recorded for a Practice round.' }, { status: 403 })
  }

  const scorecardId = await resolveOwnScorecard(admin, roundId, user.id)
  if (!scorecardId) return NextResponse.json({ error: 'You do not have a scorecard for this round.' }, { status: 404 })

  const upsertRes = await admin.from('practice_hole_stats')
    .upsert({
      scorecard_id: scorecardId,
      hole_number: holeNumber,
      fairway_hit: fairwayHit ?? null,
      gir: gir ?? null,
      putts: putts ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'scorecard_id,hole_number' })
    .select('hole_number, fairway_hit, gir, putts')
    .single()

  if (upsertRes.error) {
    console.error('[practice-stats] upsert failed', upsertRes.error.message)
    return NextResponse.json({ error: 'Could not save your stats. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ stat: upsertRes.data })
}
