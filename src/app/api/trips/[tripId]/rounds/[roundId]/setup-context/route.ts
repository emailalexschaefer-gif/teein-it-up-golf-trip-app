/**
 * GET /api/trips/[tripId]/rounds/[roundId]/setup-context
 *
 * Everything the Begin Round wizard's Step 1 needs for Round 2+:
 * - the immediately previous round's results
 * - cumulative standings across every completed round before this one
 * - current trip_members (group_id, playing_handicap) for the
 *   handicap-adjustment and group-display UI
 *
 * Deliberately reuses the exact scoring approach already established in
 * the leaderboard route (score_entries where capture_role='self' is the
 * authoritative total per player per round — the same convention used
 * everywhere else in this app to avoid double-counting self+marker
 * entries) rather than a new calculation. The actual ranking/summing
 * logic is the pure, tested computeCumulativeStandings() function
 * (src/lib/scoring/multiRound.ts) — this route only fetches raw data
 * and hands it to that function, it doesn't rank anything itself.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeCumulativeStandings, type RoundPlayerResult } from '@/lib/scoring/multiRound'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }
type AdminClient = ReturnType<typeof createAdminClient>

interface ScorecardRow {
  player_id: string; playing_handicap: number
  profiles: { full_name: string } | null
  score_entries: { stableford_pts: number; capture_role: string }[]
}

async function totalsForRound(admin: AdminClient, roundId: string): Promise<RoundPlayerResult[]> {
  const { data } = await admin
    .from('scorecards')
    .select('player_id, playing_handicap, profiles:player_id(full_name), score_entries(stableford_pts, capture_role)')
    .eq('round_id', roundId)
    .neq('status', 'withdrawn')

  return ((data ?? []) as unknown as ScorecardRow[]).map(sc => ({
    playerId: sc.player_id,
    playerName: sc.profiles?.full_name ?? 'Player',
    roundPoints: (sc.score_entries ?? [])
      .filter(e => e.capture_role === 'self')
      .reduce((sum, e) => sum + (e.stableford_pts ?? 0), 0),
  }))
}

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

    const admin: AdminClient = createAdminClient()

    const membership = await admin.from('trip_members').select('id').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
    if (!membership.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

    // This round's own created_at, to find every completed round before
    // it chronologically. There is no round_number (or equivalent
    // sequence) column anywhere in the schema — confirmed by reading the
    // actual CREATE TABLE statement, not assumed — so ordering is
    // derived from created_at, which reliably reflects creation order
    // for this app's workflow (rounds are created sequentially during
    // trip setup, so creation order already matches intended play
    // order).
    const thisRoundRes = await admin.from('rounds').select('created_at').eq('id', roundId).eq('trip_id', tripId).maybeSingle()
    if (thisRoundRes.error) {
      console.error('[setup-context] round lookup failed', { code: thisRoundRes.error.code, message: thisRoundRes.error.message, tripId, roundId })
      return NextResponse.json({ error: 'Could not load round.', debug: thisRoundRes.error.message }, { status: 500 })
    }
    if (!thisRoundRes.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })

    const priorRoundsRes = await admin
      .from('rounds')
      .select('id, created_at, name, status')
      .eq('trip_id', tripId)
      .lt('created_at', thisRoundRes.data.created_at)
      .eq('status', 'completed')
      .order('created_at', { ascending: true })
    if (priorRoundsRes.error) {
      console.error('[setup-context] prior rounds query failed', { code: priorRoundsRes.error.code, message: priorRoundsRes.error.message, tripId, roundId })
      return NextResponse.json({ error: 'Could not load previous rounds.', debug: priorRoundsRes.error.message }, { status: 500 })
    }

    const priorRounds: { id: string; created_at: string; name: string }[] = priorRoundsRes.data ?? []

    // Current groups-with-players — the single refetchable source for
    // Step 1's group display. Query syntax matches exactly what's
    // already proven working for this same table in start/route.ts
    // (profiles(...), not an aliased profiles:profile_id(...) variant) —
    // that mismatch was the actual root cause of this endpoint failing
    // on every call, including Round 1, which never even reaches the
    // previous-results logic below.
    const [groupsRes, membersRes] = await Promise.all([
      admin.from('trip_groups').select('id, name, tee_time').eq('trip_id', tripId).order('tee_time', { ascending: true, nullsFirst: false }),
      // `id` (the trip_members row's own PK) is required here, not just
      // profile_id — the members PATCH route at
      // /api/trips/[tripId]/members/[memberId] matches on trip_members.id,
      // so the client needs it to make that call. Previously this select
      // omitted it, so the client only ever had profile_id to send, which
      // matches no row on that route and always 500s. See handleHandicapAdjust
      // in BeginRoundModal.tsx for the fix on the client side.
      admin.from('trip_members').select('id, profile_id, group_id, playing_handicap, role, profiles(full_name, handicap)').eq('trip_id', tripId),
    ])
    if (groupsRes.error) {
      console.error('[setup-context] groups query failed', { code: groupsRes.error.code, message: groupsRes.error.message, tripId, roundId })
      return NextResponse.json({ error: 'Could not load playing groups.', debug: groupsRes.error.message }, { status: 500 })
    }
    if (membersRes.error) {
      console.error('[setup-context] members query failed', { code: membersRes.error.code, message: membersRes.error.message, tripId, roundId })
      return NextResponse.json({ error: 'Could not load players.', debug: membersRes.error.message }, { status: 500 })
    }

    interface MemberRow { id: string; profile_id: string; group_id: string | null; playing_handicap: number | null; role: string; profiles: { full_name: string; handicap: number | null } | null }
    const members = (membersRes.data ?? []) as unknown as MemberRow[]
    const groupsWithPlayers = ((groupsRes.data ?? []) as { id: string; name: string; tee_time: string | null }[]).map(g => ({
      id: g.id, name: g.name, tee_time: g.tee_time,
      players: members
        .filter(m => m.group_id === g.id)
        .map(m => ({
          member_id: m.id,
          profile_id: m.profile_id,
          full_name: m.profiles?.full_name ?? 'Player',
          playing_handicap: m.playing_handicap,
          profile_handicap: m.profiles?.handicap ?? null,
        })),
    }))

    if (priorRounds.length === 0) {
      // Round 1 — no previous results to show, and that's not an error.
      // Groups are still returned for consistency (a refetch after this
      // endpoint should always be a complete picture of current state).
      return NextResponse.json({ isFirstRound: true, previousRoundResults: null, cumulativeStandings: [], groups: groupsWithPlayers })
    }

    const allRoundsTotals = await Promise.all(priorRounds.map(r => totalsForRound(admin, r.id)))
    const cumulativeStandings = computeCumulativeStandings(allRoundsTotals)

    const previousRound = priorRounds[priorRounds.length - 1]
    const previousRoundTotals = allRoundsTotals[allRoundsTotals.length - 1]
    // The immediately previous round's own results, ranked the same way —
    // reusing computeCumulativeStandings on a single round is exactly
    // "cumulative standings across one round," which is just that round's
    // own results, so no separate ranking function is needed here either.
    const previousRoundResults = computeCumulativeStandings([previousRoundTotals])

    return NextResponse.json({
      isFirstRound: false,
      previousRound: { id: previousRound.id, name: previousRound.name },
      previousRoundResults,
      cumulativeStandings,
      groups: groupsWithPlayers,
    })
  } catch (err) {
    // Guarantees a proper JSON error response even if something
    // unexpected throws — previously an uncaught exception here would
    // likely have produced a non-JSON error response, which the
    // client's res.json() parsing would itself fail on, surfacing only
    // the generic client-side fallback message with no way to tell
    // what actually went wrong server-side.
    console.error('[setup-context] unhandled exception', { tripId, roundId, error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({
      error: 'Could not load setup context.',
      debug: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }
}
