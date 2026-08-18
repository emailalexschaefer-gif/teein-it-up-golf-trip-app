import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import TripDetailClient from './TripDetailClient'
import type { TripData } from './TripDetailClient'
import Link from 'next/link'
import { groupSideCompsByRound } from '@/lib/trips/sideCompRoundTrip'

// This page must always reflect the live database — it's the page that was
// showing stale round data (a round id that had already been deleted) after
// a trip edit. Force dynamic rendering so there's no possibility of a
// cached server render being served for this route.
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface Props { params: Promise<{ tripId: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tripId } = await params
  try {
    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = supabase
    const result = await db.from('trips').select('name').eq('id', tripId).maybeSingle()
    return { title: result?.data?.name ?? 'Trip' }
  } catch {
    return { title: 'Trip' }
  }
}

export default async function TripDetailPage({ params }: Props) {
  const { tripId } = await params
  const supabase   = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any    = supabase

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Membership check
  let membership: { role: string } | null = null
  let membershipError: string | null = null
  try {
    const result = await db
      .from('trip_members').select('role')
      .eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
    if (result?.error) membershipError = result.error.message
    else membership = result?.data ?? null
  } catch (err) {
    membershipError = err instanceof Error ? err.message : 'Exception querying membership'
  }

  if (membershipError || !membership) {
    return (
      <div className="max-w-lg mx-auto pt-12 px-4">
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-6">
          <h1 className="font-bold text-text mb-2">Trip not accessible</h1>
          <p className="text-sm text-text-muted mb-4">
            {membershipError ?? `You don't appear to be a member of this trip.`}
          </p>
          <p className="text-xs text-text-subtle mb-4 font-mono break-all">
            User: {user.id} · Trip: {tripId}
          </p>
          <Link href="/dashboard" className="text-sm text-brand-600 hover:underline">← Back to My Trips</Link>
        </div>
      </div>
    )
  }

  // Full trip query
  let rawTrip: TripData | null = null
  let tripError: string | null = null
  try {
    // Try full Sprint 3 query first
    let result = await db
      .from('trips')
      .select(`
        id, name, description, event_type, location, logo_url,
        start_date, end_date, status, invite_code,
        expected_players, players_per_group, organiser_is_playing, groups_released,
        trip_members (
          id, role, profile_id, group_id, playing_handicap,
          profiles ( id, full_name, avatar_url, handicap )
        ),
        rounds (
          id, name, course_name, play_date, tee_time, holes, scoring_format, status,
          tee_set_source_id, tee_name, course_rating, slope_rating, library_holes_snapshot
        )
      `)
      .eq('id', tripId).maybeSingle()

    // If Sprint 3 columns are missing (migration not yet applied), retry without them
    if (result?.error) {
      const msg: string = result.error.message ?? ''
      const isMissingCol = msg.includes('does not exist') && (
        msg.includes('group_id') || msg.includes('expected_players') ||
        msg.includes('players_per_group') || msg.includes('organiser_is_playing') ||
        msg.includes('playing_handicap') || msg.includes('handicap_status')
      )
      // Sprint 9 (migration 037) — same resilience pattern, separate check:
      // side_comps not found as a relationship (Postgrest's message for
      // an unrecognised nested table — this is a substring check on that
      // wording, not a specific-column check, since side_comps is a
      // whole related table, not a single column on trips/rounds).
      const isMissingSideComp = msg.toLowerCase().includes('side_comps')
      // Course Library v1 (migrations 039/041) — same resilience pattern
      // again: any of the new rounds columns missing (039 not yet
      // applied) falls back the same way.
      const isMissingCourseLibrary = msg.includes('does not exist') && (
        msg.includes('tee_set_source_id') || msg.includes('tee_name') ||
        msg.includes('course_rating') || msg.includes('slope_rating') ||
        msg.includes('library_holes_snapshot')
      )
      // Deployment 1 (migration 058) — same resilience pattern again,
      // for the one new column this deployment adds.
      const isMissingGroupsReleased = msg.includes('does not exist') && msg.includes('groups_released')
      if (isMissingCol) {
        console.warn('[trip page] Sprint 3 columns missing — run 012_sprint3_schema.sql in Supabase SQL Editor')
        result = await db
          .from('trips')
          .select(`
            id, name, description, event_type, location, logo_url,
            start_date, end_date, status, invite_code,
            trip_members (
              id, role, profile_id,
              profiles ( id, full_name, avatar_url, handicap )
            ),
            rounds (
              id, name, course_name, play_date, tee_time, holes, scoring_format, status
            )
          `)
          .eq('id', tripId).maybeSingle()
      } else if (isMissingSideComp || isMissingCourseLibrary) {
        console.warn('[trip page] Sprint 9 / Course Library columns missing — run 037_side_competitions_powerplay.sql, 039_course_library.sql and 041_round_library_snapshot_column.sql in Supabase SQL Editor')
        result = await db
          .from('trips')
          .select(`
            id, name, description, event_type, location, logo_url,
            start_date, end_date, status, invite_code,
            expected_players, players_per_group, organiser_is_playing,
            trip_members (
              id, role, profile_id, group_id, playing_handicap,
              profiles ( id, full_name, avatar_url, handicap )
            ),
            rounds (
              id, name, course_name, play_date, tee_time, holes, scoring_format, status
            )
          `)
          .eq('id', tripId).maybeSingle()
      } else if (isMissingGroupsReleased) {
        console.warn('[trip page] groups_released column missing — run 058_groups_released.sql in Supabase SQL Editor')
        result = await db
          .from('trips')
          .select(`
            id, name, description, event_type, location, logo_url,
            start_date, end_date, status, invite_code,
            expected_players, players_per_group, organiser_is_playing,
            trip_members (
              id, role, profile_id, group_id, playing_handicap,
              profiles ( id, full_name, avatar_url, handicap )
            ),
            rounds (
              id, name, course_name, play_date, tee_time, holes, scoring_format, status,
              tee_set_source_id, tee_name, course_rating, slope_rating, library_holes_snapshot
            )
          `)
          .eq('id', tripId).maybeSingle()
      }
    }

    if (result?.error) tripError = result.error.message
    else rawTrip = result?.data ?? null
  } catch (err) {
    tripError = err instanceof Error ? err.message : 'Exception querying trip'
  }

  if (tripError || !rawTrip) {
    return (
      <div className="max-w-lg mx-auto pt-12 px-4">
        <div className="rounded-2xl bg-red-50 border border-red-200 p-6">
          <h1 className="font-bold text-text mb-2">Couldn&apos;t load trip</h1>
          <p className="text-sm text-text-muted mb-4">{tripError ?? 'Trip not found.'}</p>
          <Link href="/dashboard" className="text-sm text-brand-600 hover:underline">← Back to My Trips</Link>
        </div>
      </div>
    )
  }

  // Fetch actual groups (id + name) — used for the group count AND, for
  // the new player dashboard, to look up the current user's own group
  // name from their trip_members.group_id.
  let fetchedGroups: { id: string; name: string }[] = []
  try {
    const groupsResult = await db
      .from('trip_groups')
      .select('id, name')
      .eq('trip_id', tripId)
      .order('sort_order')
    fetchedGroups = groupsResult.data ?? []
  } catch {
    // trip_groups table may not exist yet — default to empty
  }

  // Side Competitions — fetched as an explicit, separate, flat query
  // rather than nested inside the trips->rounds embed above. This is a
  // deliberate simplification, not a stylistic preference: a 3-level
  // nested PostgREST embed (trips -> rounds -> side_comps) through the
  // RLS-subject client is a combination used nowhere else in this
  // codebase — every other place this app reads side_comps (Side Games,
  // Golf Story, Final Results, the scoring holes route) does so via a
  // flat, single-level query, several of them via the admin client
  // specifically to sidestep exactly this kind of embed/RLS interaction
  // entirely. Replacing the nested embed with the same flat-query
  // pattern already proven reliable everywhere else in this app removes
  // an untested combination as a variable, regardless of whether it was
  // the actual cause of side competitions failing to round-trip through
  // Edit Trip.
  const roundIds = (rawTrip.rounds ?? []).map(r => r.id)
  let sideCompsByRound = new Map<string, { id: string; comp_type: string; hole_number: number | null; enabled: boolean }[]>()
  if (roundIds.length > 0) {
    try {
      const sideCompsResult = await db
        .from('side_comps')
        .select('id, round_id, comp_type, hole_number, enabled')
        .in('round_id', roundIds)
      sideCompsByRound = groupSideCompsByRound((sideCompsResult.data ?? []) as { id: string; round_id: string; comp_type: string; hole_number: number | null; enabled: boolean }[])
    } catch {
      // Side Competitions are additive to the trip page, never fatal to
      // it — a failure here should not take down Edit Trip / trip
      // overview entirely. Rounds simply show with no side_comps
      // attached, same as a trip that genuinely has none configured.
      sideCompsByRound = new Map()
    }
  }

  const sortedTrip: TripData = {
    ...rawTrip,
    trip_groups: fetchedGroups,
    rounds: [...(rawTrip.rounds ?? [])]
      .map(r => ({ ...r, side_comps: sideCompsByRound.get(r.id) ?? [] }))
      .sort((a, b) => a.play_date.localeCompare(b.play_date)),
  }

  return (
    <TripDetailClient
      trip={sortedTrip}
      currentUserId={user.id}
      userRole={membership.role as 'organiser' | 'player'}
    />
  )
}
