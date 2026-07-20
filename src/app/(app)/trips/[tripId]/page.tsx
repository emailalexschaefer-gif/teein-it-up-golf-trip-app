import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import TripDetailClient from './TripDetailClient'
import Link from 'next/link'

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
  let rawTrip: any = null
  let tripError: string | null = null
  try {
    // Try full Sprint 3 query first
    let result = await db
      .from('trips')
      .select(`
        id, name, description, event_type, location,
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

    // If Sprint 3 columns are missing (migration not yet applied), retry without them
    if (result?.error) {
      const msg: string = result.error.message ?? ''
      const isMissingCol = msg.includes('does not exist') && (
        msg.includes('group_id') || msg.includes('expected_players') ||
        msg.includes('players_per_group') || msg.includes('organiser_is_playing') ||
        msg.includes('playing_handicap') || msg.includes('handicap_status')
      )
      if (isMissingCol) {
        console.warn('[trip page] Sprint 3 columns missing — run 012_sprint3_schema.sql in Supabase SQL Editor')
        result = await db
          .from('trips')
          .select(`
            id, name, description, event_type, location,
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

  // Fetch actual group count for initial render (so Overview shows correct count
  // before the Groups tab is visited and onGroupsLoaded fires)
  let initialGroupCount = 0
  try {
    const groupsResult = await db
      .from('trip_groups')
      .select('id', { count: 'exact', head: true })
      .eq('trip_id', tripId)
    initialGroupCount = groupsResult.count ?? 0
  } catch {
    // trip_groups table may not exist yet — default to 0
  }

  const sortedTrip = {
    ...rawTrip,
    trip_groups: Array.from({ length: initialGroupCount }, (_, i) => ({ id: String(i) })),
    rounds: [...(rawTrip.rounds ?? [])].sort(
      (a: { play_date?: string }, b: { play_date?: string }) =>
        (a.play_date ?? '').localeCompare(b.play_date ?? '')
    ),
  }

  return (
    <TripDetailClient
      trip={sortedTrip as any}
      currentUserId={user.id}
      userRole={membership.role as 'organiser' | 'player'}
    />
  )
}
