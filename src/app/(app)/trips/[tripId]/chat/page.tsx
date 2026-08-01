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
    .from('trip_members').select('role, group_id')
    .eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  const isOrganiser = membership?.role === 'organiser'

  let myGroupName: string | null = null
  if (membership?.group_id) {
    const { data: group } = await supabase.from('trip_groups').select('name').eq('id', membership.group_id).maybeSingle()
    myGroupName = group?.name ?? null
  }

  return (
    <div style={{ minHeight: '100vh', background: '#faf9f6', padding: '16px 16px 90px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Link href={`/trips/${tripId}`} style={{ color: '#9ca3af', fontSize: 18, textDecoration: 'none' }}>←</Link>
        <span style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 18, fontWeight: 800 }}>Chat</span>
      </div>

      {/* Announcements/notifications (organiser) and ordinary group chat
          (any participant) — differentiated message model, per the
          explicit requirement not to route chat through organiser
          permissions. */}
      <EventMessages tripId={tripId} isOrganiser={isOrganiser} myGroupId={membership?.group_id ?? null} myGroupName={myGroupName} />
    </div>
  )
}
