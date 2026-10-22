/**
 * Release 3S -- the member (event-only) presentation. Served from the stored
 * snapshot so it is identical for Chat, My Golf and anyone opening it later,
 * and unaffected by later event edits. Members only; media is authorised per
 * request by /api/trips/[tripId]/presentation/media/[momentId].
 */
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getAdmin, getMemberRole } from '@/lib/sharing/server'
import { resolveMediaMarkers, type StoredDeck } from '@/lib/sharing/snapshot'
import SharedPresentationViewer from '@/components/memories/SharedPresentationViewer'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface Props { params: Promise<{ tripId: string }> }
interface EventRow { title: string; event_deck: StoredDeck; approved_event_moment_ids: string[]; duration_seconds: number }

function Unavailable({ tripId, message }: { tripId: string; message: string }) {
  return (
    <main style={{ minHeight: '60dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
      <h1 style={{ fontFamily: 'var(--font-display), serif', fontSize: 24, margin: '0 0 8px' }}>{message}</h1>
      <Link href={`/trips/${tripId}`} style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', textDecoration: 'underline' }}>Back to the event</Link>
    </main>
  )
}

export default async function MemberPresentationPage({ params }: Props) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = getAdmin()
  if (!user || !(await getMemberRole(admin, tripId, user.id))) return <Unavailable tripId={tripId} message="This presentation is not available to you" />
  const { data } = await admin.from('shared_presentations')
    .select('title, event_deck, approved_event_moment_ids, duration_seconds')
    .eq('trip_id', tripId).eq('scope_key', 'event').eq('status', 'active').maybeSingle()
  const row = data as EventRow | null
  if (!row) return <Unavailable tripId={tripId} message="This presentation is no longer available" />
  const allowed = new Set(row.approved_event_moment_ids ?? [])
  const slides = resolveMediaMarkers(row.event_deck.slides, allowed, id => `/api/trips/${tripId}/presentation/media/${id}`)
  const duration = row.duration_seconds === 5 || row.duration_seconds === 10 ? row.duration_seconds : 8
  return (
    <SharedPresentationViewer
      mode="member" eventName={row.title} slides={slides} durationSeconds={duration} backHref={`/trips/${tripId}`}
      aftershowStartIndex={row.event_deck.aftershowStartIndex} aftershowLoop={row.event_deck.aftershowLoop}
    />
  )
}
