import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { selectMostRecentTrip } from '@/lib/trips/selectMostRecentTrip'

/**
 * GET /api/me/golf-summary
 *
 * Homepage "My Golf" achievement summary. One RPC call (see migration
 * 068 for the full derivation of each number and the documented
 * event_wins simplification) — no N+1 pattern, no separate query per
 * metric.
 *
 * Auth-scoped to the caller only — p_player_id is always the
 * authenticated user's own id, never a client-supplied value, so this
 * can never be used to pull another player's summary.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  const admin = createAdminClient()
  const [{ data, error }, recentTripRes] = await Promise.all([
    admin.rpc('get_my_golf_summary', { p_player_id: user.id }),
    // "View My Golf →" — My Golf is genuinely a per-trip experience in
    // this app (/trips/[tripId]/tournament); there is no separate
    // global cross-trip page to link to, and building one is out of
    // scope for this feature ("No duplicated My Golf implementation").
    // Picks the single most sensible existing destination instead: the
    // player's most recently active trip. Prefers a currently live/
    // upcoming trip over a completed one, so a player mid-event lands
    // on their actual current round, not stale history.
    admin.from('trip_members')
      .select('trip_id, trips!inner(id, status, updated_at)')
      .eq('profile_id', user.id)
      .limit(50),
  ])

  if (error) {
    console.error('[golf-summary] RPC failed', { code: error.code, message: error.message })
    return NextResponse.json({ error: 'Could not load your golf summary.' }, { status: 500 })
  }

  const row = Array.isArray(data) ? data[0] : data

  const memberRows = (recentTripRes.data ?? []) as unknown as { trip_id: string; trips: { id: string; status: string; updated_at: string } }[]
  const mostRecentTripId = selectMostRecentTrip(
    memberRows.map(m => ({ tripId: m.trip_id, status: m.trips?.status ?? '', updatedAt: m.trips?.updated_at ?? '' }))
  )

  return NextResponse.json({
    eventsPlayed:    row?.events_played ?? 0,
    badges:          row?.badges ?? 0,
    eventWins:       row?.event_wins ?? 0,
    sideGameWins:    row?.side_game_wins ?? 0,
    latestBadgeTitle: row?.latest_badge_title ?? null,
    mostRecentTripId,
  })
}
