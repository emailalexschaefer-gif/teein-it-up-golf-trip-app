import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import TripDetailClient from './TripDetailClient'

interface Props { params: { tripId: string } }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const supabase = createClient()
  const { data } = await supabase
    .from('trips')
    .select('name')
    .eq('id', params.tripId)
    .single()
  return { title: data?.name ?? 'Trip' }
}

export default async function TripDetailPage({ params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return notFound()

  // Verify membership — defence in depth behind middleware
  const { data: membership } = await supabase
    .from('trip_members')
    .select('role')
    .eq('trip_id', params.tripId)
    .eq('profile_id', user.id)
    .single()

  if (!membership) return notFound()

  // Full trip with members + rounds
  const { data: trip } = await supabase
    .from('trips')
    .select(`
      id, name, description, event_type, location,
      start_date, end_date, status, invite_code,
      trip_members (
        id, role, profile_id,
        profiles ( id, full_name, avatar_url )
      ),
      rounds (
        id, name, course_name, play_date, tee_time, holes, scoring_format, status
      )
    `)
    .eq('id', params.tripId)
    .single()

  if (!trip) return notFound()

  // Sort rounds by date client-side (PostgREST nested ordering is version-dependent)
  const sortedTrip = {
    ...trip,
    rounds: [...(trip.rounds ?? [])].sort((a, b) =>
      a.play_date.localeCompare(b.play_date)
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
