import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import TripDetailClient from './TripDetailClient'
import type { TripRole } from '@/types/app'

// Next 15: params is a Promise
interface Props { params: Promise<{ tripId: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tripId } = await params
  const supabase   = await createClient()
  const { data }   = await supabase
    .from('trips')
    .select('name')
    .eq('id', tripId)
    .single() as { data: { name: string } | null; error: unknown }
  return { title: data?.name ?? 'Trip' }
}

export default async function TripDetailPage({ params }: Props) {
  const { tripId } = await params
  const supabase   = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return notFound()

  // Membership gate — explicitly typed to avoid `never` inference
  const { data: membership } = await supabase
    .from('trip_members')
    .select('role')
    .eq('trip_id', tripId)
    .eq('profile_id', user.id)
    .single() as { data: { role: TripRole } | null; error: unknown }

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
    .single() as { data: Record<string, unknown> | null; error: unknown }

  if (!trip) return notFound()

  const sortedTrip = {
    ...(trip as any),
    rounds: [...((trip as any).rounds ?? [])].sort(
      (a: { play_date: string }, b: { play_date: string }) =>
        a.play_date.localeCompare(b.play_date)
    ),
  }

  return (
    <TripDetailClient
      trip={sortedTrip}
      currentUserId={user.id}
      userRole={membership.role}
    />
  )
}
