import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import TripDetailClient from './TripDetailClient'

interface Props { params: Promise<{ tripId: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tripId } = await params
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = supabase
  const result = await db.from('trips').select('name').eq('id', tripId).maybeSingle()
  return { title: result?.data?.name ?? 'Trip' }
}

export default async function TripDetailPage({ params }: Props) {
  const { tripId } = await params
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = supabase

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return notFound()

  const membershipResult = await db
    .from('trip_members')
    .select('role')
    .eq('trip_id', tripId)
    .eq('profile_id', user.id)
    .maybeSingle()

  const membership = membershipResult?.data ?? null
  if (!membership) return notFound()

  const tripResult = await db
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

  const rawTrip = tripResult?.data ?? null
  if (!rawTrip) return notFound()

  const sortedTrip = {
    ...rawTrip,
    rounds: [...(rawTrip.rounds ?? [])].sort(
      (a: { play_date?: string }, b: { play_date?: string }) =>
        (a.play_date ?? '').localeCompare(b.play_date ?? '')
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
