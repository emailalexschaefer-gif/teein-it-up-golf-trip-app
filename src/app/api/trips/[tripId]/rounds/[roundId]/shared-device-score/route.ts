/**
 * POST /api/trips/[tripId]/rounds/[roundId]/shared-device-score
 * body: { holeNumber: number, grossScore: number | null, isNoReturn: boolean }
 *
 * Add-on 1 — Shared-Device Scoring. Writes the CALLER's own group-mate's
 * (the paper player's) official score for one hole, using the exact
 * same applyHoleOverride function Enter Paper Scorecard and organiser
 * override already use — capture_role='self' directly on the paper
 * player's own scorecard, which is what already makes every other
 * requirement in this feature true automatically, not by new logic
 * written here:
 *
 * - "Alex's entry becomes Mick's official score" — capture_role='self'
 *   already IS the authoritative source every leaderboard/results/My
 *   HQ query reads.
 * - "No reconciliation for Mick" — no marker row is ever written for
 *   Mick in this flow, so there is nothing to compare against; and the
 *   admin_overridden flag this function sets would supersede any
 *   mismatch check regardless.
 * - "Leaderboard/Stableford updates live" — the same compute_stableford
 *   DB trigger (migration 000) fires on this exact UPDATE, unchanged.
 * - "No Paper Card Outstanding once complete" — tournament/route.ts's
 *   paperCardOutstanding is already just "does this player have fewer
 *   than totalHoles self-entries" — it does not care how those entries
 *   were written, so it already reads this correctly with no further
 *   change needed.
 *
 * Authorization is deliberately NOT "caller is organiser" (unlike the
 * batch-override route this reuses applyHoleOverride from) — Alex is
 * an ordinary digital player, not an organiser. Eligibility instead
 * requires the caller and the target player to be the exact "1 Digital
 * + 1 Paper" pair this feature is scoped to, re-derived server-side
 * from real scorecards data on every call, never trusted from the
 * client.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { applyHoleOverride } from '@/lib/scoring/applyHoleOverride'
import { detectSharedDeviceGroup } from '@/lib/scoring/sharedDeviceScoring'

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

export async function POST(req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  type AdminClient = ReturnType<typeof createAdminClient>
  const admin: AdminClient = createAdminClient()

  const membership = await admin.from('trip_members').select('group_id').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!membership.data || !membership.data.group_id) return NextResponse.json({ error: 'Not a trip member with a playing group.' }, { status: 403 })

  // Re-derive the shared-device pairing from real data — never trust a
  // paperPlayerId supplied by the client. Every scorecard belonging to
  // a genuine member of the caller's own group, for this round, is
  // exactly the shape detectSharedDeviceGroup expects.
  const [groupCards, membersRes] = await Promise.all([
    admin.from('scorecards').select('id, player_id, scoring_method').eq('round_id', roundId).neq('status', 'withdrawn'),
    admin.from('trip_members').select('profile_id').eq('trip_id', tripId).eq('group_id', membership.data.group_id),
  ])
  const groupProfileIds = new Set((membersRes.data ?? []).map((m: { profile_id: string }) => m.profile_id))
  const relevantCards = (groupCards.data ?? []).filter((c: { player_id: string }) => groupProfileIds.has(c.player_id))

  const detection = detectSharedDeviceGroup(
    relevantCards.map((c: { player_id: string; scoring_method: string }) => ({ playerId: c.player_id, scoringMethod: c.scoring_method === 'paper' ? 'paper' : 'digital' }))
  )

  if (!detection.isSharedDevice || detection.digitalPlayerId !== user.id) {
    return NextResponse.json({ error: 'This round is not set up for shared-device scoring for you.' }, { status: 403 })
  }
  const paperCard = relevantCards.find((c: { player_id: string }) => c.player_id === detection.paperPlayerId)
  if (!paperCard) return NextResponse.json({ error: "Couldn't find your playing partner's scorecard." }, { status: 404 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const holeNumber = typeof body.holeNumber === 'number' ? body.holeNumber : null
  const isNoReturn = body.isNoReturn === true
  const grossScore = typeof body.grossScore === 'number' ? body.grossScore : null
  if (holeNumber === null) return NextResponse.json({ error: 'holeNumber is required.' }, { status: 400 })
  if (!isNoReturn && (grossScore === null || grossScore < 1 || grossScore > 20)) {
    return NextResponse.json({ error: 'Enter a valid gross score between 1 and 20, or mark as no return.' }, { status: 400 })
  }

  const result = await applyHoleOverride(
    admin, paperCard.id, roundId, holeNumber, grossScore, isNoReturn,
    'Shared-device scoring', user.id,
  )
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json({ ok: true, scoreEntryId: result.scoreEntryId })
}
