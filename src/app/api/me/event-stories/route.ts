import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/me/event-stories
 *
 * My Golf brief, item 9 — a chronological INDEX of the player's
 * completed events, each linking to the existing per-trip Event Story
 * (MyGolfEventStory.tsx / the final-results endpoint it already
 * consumes) — this route does NOT reimplement Event Story, and does
 * NOT load any trip's full final-results/highlights payload. Per the
 * explicit item 17 performance requirement ("do not load every Event
 * Story in full on initial page load... load summary/index data
 * first"), this only returns what's needed to render the index list
 * itself: name, courses, date range, and two small counts. Tapping
 * "View Event Story →" is what triggers the existing, richer
 * final-results fetch for that one specific trip — unchanged,
 * untouched, not duplicated here.
 *
 * Badge count reuses the exact same published_round_highlights source
 * as /api/me/badges (grouped by trip instead of by category here) —
 * not a second, differently-derived number. Side game win count reuses
 * the exact same side_comp_lead_changes "latest entry is the genuine
 * leader" signal already established in migration 068's RPC.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  const admin = createAdminClient()

  const membershipRes = await admin.from('trip_members')
    .select('trip_id, trips!inner ( id, name, status )')
    .eq('profile_id', user.id)
  const completedTripIds = ((membershipRes.data ?? []) as unknown as { trip_id: string; trips: { id: string; name: string; status: string } }[])
    .filter(m => m.trips?.status === 'completed')
    .map(m => m.trip_id)

  if (completedTripIds.length === 0) {
    return NextResponse.json({ eventStories: [] })
  }

  const [roundsRes, highlightsRes, leadersRes, tripsRes] = await Promise.all([
    admin.from('rounds').select('trip_id, course_name, play_date').in('trip_id', completedTripIds),
    admin.from('published_round_highlights').select('trip_id, highlights').in('trip_id', completedTripIds),
    admin.from('side_comp_lead_changes')
      .select('side_comp_id, player_id, sequence_number, side_comps!inner ( trip_id )')
      .order('sequence_number', { ascending: false }),
    admin.from('trips').select('id, name').in('id', completedTripIds),
  ])

  const tripNameById = new Map((tripsRes.data ?? []).map((t: { id: string; name: string }) => [t.id, t.name]))

  const roundsByTrip = new Map<string, { course_name: string | null; play_date: string | null }[]>()
  for (const r of (roundsRes.data ?? []) as { trip_id: string; course_name: string | null; play_date: string | null }[]) {
    const list = roundsByTrip.get(r.trip_id) ?? []
    list.push(r)
    roundsByTrip.set(r.trip_id, list)
  }

  const badgeCountByTrip = new Map<string, number>()
  for (const row of (highlightsRes.data ?? []) as { trip_id: string; highlights: { playerId: string }[] }[]) {
    const mine = (row.highlights ?? []).filter(h => h.playerId === user.id).length
    if (mine > 0) badgeCountByTrip.set(row.trip_id, (badgeCountByTrip.get(row.trip_id) ?? 0) + mine)
  }

  // Latest entry per side_comp_id = genuine final leader (same signal
  // as migration 068's RPC) — dedupe client-side since this route
  // doesn't warrant its own RPC for one small aggregation.
  const seenSideComp = new Set<string>()
  const sideGameWinCountByTrip = new Map<string, number>()
  for (const row of (leadersRes.data ?? []) as unknown as { side_comp_id: string; player_id: string; side_comps: { trip_id: string } }[]) {
    if (seenSideComp.has(row.side_comp_id)) continue
    seenSideComp.add(row.side_comp_id)
    if (row.player_id !== user.id) continue
    const tripId = row.side_comps?.trip_id
    if (tripId && completedTripIds.includes(tripId)) {
      sideGameWinCountByTrip.set(tripId, (sideGameWinCountByTrip.get(tripId) ?? 0) + 1)
    }
  }

  const eventStories = completedTripIds.map(tripId => {
    const rounds = roundsByTrip.get(tripId) ?? []
    const courses = [...new Set(rounds.map(r => r.course_name).filter((c): c is string => !!c))]
    const dates = rounds.map(r => r.play_date).filter((d): d is string => !!d).sort()
    return {
      tripId,
      tripName: tripNameById.get(tripId) ?? 'Event',
      courses,
      startDate: dates[0] ?? null,
      endDate: dates[dates.length - 1] ?? null,
      badgeCount: badgeCountByTrip.get(tripId) ?? 0,
      sideGameWinCount: sideGameWinCountByTrip.get(tripId) ?? 0,
    }
  }).sort((a, b) => (b.endDate ?? '').localeCompare(a.endDate ?? '')) // most recent event first

  return NextResponse.json({ eventStories })
}
