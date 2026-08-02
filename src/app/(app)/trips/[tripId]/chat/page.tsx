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

  // Active round, if any — passed through so a Moment captured from Chat
  // (rather than mid-scoring) still gets tagged with the round it
  // belongs to. Not hole-specific here, since Chat isn't a scoring screen.
  const { data: activeRound } = await supabase
    .from('rounds').select('id').eq('trip_id', tripId).eq('status', 'active').maybeSingle()

  return (
    <div style={{ minHeight: '100vh', background: '#faf9f6', padding: '16px 16px 90px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Link href={`/trips/${tripId}`} style={{ color: '#9ca3af', fontSize: 18, textDecoration: 'none' }}>←</Link>
        <span style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 18, fontWeight: 800 }}>Chat</span>
      </div>

      {/* Announcements (organiser), group notifications (organiser),
          ordinary participant chat, and Moments — all in one feed, per
          Sprint 6's explicit "do not create a second chat feed." */}
      <EventMessages
        tripId={tripId} isOrganiser={isOrganiser}
        myGroupId={membership?.group_id ?? null} myGroupName={myGroupName}
        roundId={activeRound?.id ?? null}
      />
    </div>
  )
}
