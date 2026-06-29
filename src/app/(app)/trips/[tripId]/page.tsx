import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import TripDetailClient from './TripDetailClient'

interface Props { params: Promise<{ tripId: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tripId } = await params
  const supabase   = await createClient()
  const result     = await supabase.from('trips').select('name').eq('id', tripId).maybeSingle()
  return { title: result.data?.name ?? 'Trip' }
}

export default async function TripDetailPage({ params }: Props) {
  const { tripId } = await params
  const supabase   = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return notFound()

  // Membership gate
  const membershipResult = await supabase
    .from('trip_members')
    .select('role')
    .eq('trip_id', tripId)
    .eq('profile_id', user.id)
    .maybeSingle()

  if (!membershipResult.data) return notFound()
  const membership = membershipResult.data

  const tripResult = await supabase
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

  if (!tripResult.data) return notFound()

  const rawTrip = tripResult.data
  const sortedTrip = {
    ...rawTrip,
    rounds: [...(rawTrip.rounds ?? [])].sort((a, b) =>
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
