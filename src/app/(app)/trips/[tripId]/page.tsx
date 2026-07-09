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
    const result = await db
      .from('trips')
      .select(`
        id, name, description, event_type, location,
        start_date, end_date, status, invite_code,
        expected_players, players_per_group,
        trip_members (
          id, role, profile_id, group_id,
          profiles ( id, full_name, avatar_url )
        ),
        rounds (
          id, name, course_name, play_date, tee_time, holes, scoring_format, status
        )
      `)
      .eq('id', tripId).single()

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

  const sortedTrip = {
    ...rawTrip,
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
