/**
 * GET /api/trips/[tripId]/side-games
 *
 * Event-level Side Games — the new default. Relevant rounds: every
 * COMPLETED round (preserves all verified history so far) plus the
 * ACTIVE round if one exists (shows live state through it). An
 * 'upcoming' round with no competitions played yet contributes nothing
 * — there's nothing to show for it, not an empty placeholder.
 *
 * This satisfies all three required states from a single, uniform rule
 * rather than three separate code paths:
 *   - Active round: completed rounds' history + the active round's live
 *     state, exactly as required.
 *   - Between rounds: no round is 'active', so this is just every
 *     completed round's preserved history — exactly the "between
 *     rounds" requirement, met by the same rule, not a special case.
 *   - Event complete: every round ends up 'completed', so this
 *     naturally becomes "every round" — again the same rule, not a
 *     third special case.
 *
 * Deliberately reuses computeRoundSideGames (src/lib/sideGames/
 * computeRoundSideGames.ts) per round — the exact same leader/winner/
 * closure/Powerplay logic as the single-round drill-down route, called
 * once per relevant round rather than reimplemented. Grouped by round in
 * the response, never merged into one undifferentiated list — a side
 * comp is inherently tied to the specific round it was configured on
 * (its own side_comp_id), so "NTP Hole 7" in Round 1 and "NTP Hole 7" in
 * Round 2 are always kept as two entirely separate entries, never
 * collapsed.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeRoundSideGames } from '@/lib/sideGames/computeRoundSideGames'
import { selectRelevantSideGameRounds, getRoundDisplayName } from '@/lib/scoring/multiRound'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteProps { params: Promise<{ tripId: string }> }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId } = await params
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

    type AdminClient = ReturnType<typeof createAdminClient>
    const admin: AdminClient = createAdminClient()

    const memberCheck = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
    if (!memberCheck.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

    const roundsRes = await admin.from('rounds').select('id, name, course_name, status, play_date, created_at').eq('trip_id', tripId)
    // Same deterministic tiebreaker as the Leaderboard fix, wrapped in
    // selectRelevantSideGameRounds (now unit-tested) rather than an
    // inline filter — rounds created together at trip setup can share
    // an identical play_date, and this list's order directly determines
    // each round's displayed position, so it needs the same guarantee
    // against non-deterministic ordering as the Leaderboard fix did.
    const relevantRounds = selectRelevantSideGameRounds((roundsRes.data ?? []) as { id: string; name: string; course_name: string | null; status: string; play_date: string; created_at: string }[])

    const roundsData = await Promise.all(relevantRounds.map(async (round, idx) => ({
      roundId: round.id, roundNumber: idx + 1,
      // P0 field-test fix — same root cause as the round-numbering bug
      // elsewhere (My HQ, round setup, schedule cards): round.name is a
      // stored value that can legitimately disagree with this round's
      // actual chronological position the moment a round is added out
      // of order. getRoundDisplayName is the one shared correction
      // used everywhere else — applying it here too so this screen
      // can't independently drift from what every other screen shows
      // for the same round.
      roundName: getRoundDisplayName(round, relevantRounds), courseName: round.course_name,
      status: round.status,
      competitions: await computeRoundSideGames(admin, round.id),
    })))

    return NextResponse.json({ roundsData })
  } catch (err) {
    console.error('[side-games event-level]', err)
    return NextResponse.json({ error: 'Could not load Side Games.' }, { status: 500 })
  }
}
