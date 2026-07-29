import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import EventMessages from '@/components/chat/EventMessages'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface Props { params: Promise<{ tripId: string }> }

export default async function ChatPage({ params }: Props) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('trip_members').select('role')
    .eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  const isOrganiser = membership?.role === 'organiser'

  return (
    <div style={{ minHeight: '100vh', background: '#faf9f6', padding: '16px 16px 90px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Link href={`/trips/${tripId}`} style={{ color: '#9ca3af', fontSize: 18, textDecoration: 'none' }}>←</Link>
        <span style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 18, fontWeight: 800 }}>Chat</span>
      </div>

      {/* Announcements & targeted notifications — this pass's scope,
          deliberately not a full open player-to-player chat yet. */}
      <EventMessages tripId={tripId} isOrganiser={isOrganiser} />
    </div>
  )
}
