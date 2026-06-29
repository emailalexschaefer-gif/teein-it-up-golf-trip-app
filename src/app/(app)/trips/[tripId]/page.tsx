import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import TripDetailClient from './TripDetailClient'

// Next 15: params is a Promise
interface Props { params: Promise<{ tripId: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tripId }  = await params
  const supabase    = await createClient()
  const { data }    = await supabase.from('trips').select('name').eq('id', tripId).single()
  return { title: data?.name ?? 'Trip' }
}

export default async function TripDetailPage({ params }: Props) {
  const { tripId } = await params
  const supabase   = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return notFound()

  // Membership gate
  const { data: membership } = await supabase
    .from('trip_members')
    .select('role')
    .eq('trip_id', tripId)
    .eq('profile_id', user.id)
    .single()

  if (!membership) return notFound()

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
    .eq('id', tripId)
    .single()

  if (!trip) return notFound()

  const sortedTrip = {
    ...trip,
    rounds: [...(trip.rounds ?? [])].sort((a, b) => a.play_date.localeCompare(b.play_date)),
  }

  return (
    <TripDetailClient
      trip={sortedTrip as any}
      currentUserId={user.id}
      userRole={membership.role as 'organiser' | 'player'}
    />
  )
}
