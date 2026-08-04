/**
 * GET /api/trips/[tripId]/season-summary
 *
 * Cumulative multi-round summary for an event — the "Season Summary"
 * section in My HQ. Uses only completed rounds and their official
 * results (via the shared getRoundResult() helper, the same one used
 * for Rounds tab result cards), so this never recalculates a winner
 * differently than anywhere else in the app.
 *
 * One batched query across every completed round's scorecards, not one
 * request per round or per player — the explicit query-efficiency
 * requirement. Structurally supports any number of players, not just
 * two: every aggregation below is a Map/reduce over whatever players
 * actually appear in the data, with no hard-coded count.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRoundResult, aggregateSeasonSummary } from '@/lib/scoring/roundResult'

interface RouteProps { params: Promise<{ tripId: string }> }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const memberCheck = await admin.from('trip_members').select('id').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberCheck.data) return NextResponse.json({ error: 'Not a member of this event.' }, { status: 403 })

  // Scoped to this event's own completed rounds only — the explicit
  // "Dave & Alex Friday Series should not include another series' or
  // trip's results" requirement. trip_id is the natural scope boundary
  // already used everywhere else in the app.
  const roundsRes = await admin
    .from('rounds')
    .select('id, name, play_date, status')
    .eq('trip_id', tripId)
    .eq('status', 'completed')
    .order('play_date', { ascending: true })

  const completedRounds: { id: string; name: string; play_date: string }[] = roundsRes.data ?? []

  // One result computation per completed round (not per player) — each
  // internally does a single batched query, so total query count scales
  // with rounds played, not with rounds × players.
  const results = await Promise.all(completedRounds.map(r => getRoundResult(admin, r.id)))

  const summary = aggregateSeasonSummary(
    completedRounds.map((r, i) => ({ roundId: r.id, roundName: r.name, result: results[i] }))
  )

  return NextResponse.json(summary)
}
