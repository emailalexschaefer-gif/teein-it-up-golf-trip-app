import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import TournamentControl from '@/components/scoring/TournamentControl'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface Props { params: Promise<{ tripId: string }> }

export default async function TournamentPage({ params }: Props) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Real permission guard, not just hiding the nav link — a player typing
  // this URL directly must not reach organiser content, per the explicit
  // "do not expose disabled organiser actions to normal players" instruction.
  const { data: membership } = await supabase
    .from('trip_members').select('role')
    .eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()

  if (membership?.role !== 'organiser') redirect(`/trips/${tripId}`)

  const { data: rounds } = await supabase
    .from('rounds')
    .select('id, name, status, play_date')
    .eq('trip_id', tripId)
    .order('play_date', { ascending: false })

  const activeRound = rounds?.find(r => r.status === 'active')

  return (
    <div style={{ minHeight: '100vh', background: '#faf9f6', padding: '16px 16px 90px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Link href={`/trips/${tripId}`} style={{ color: '#9ca3af', fontSize: 18, textDecoration: 'none' }}>←</Link>
        <span style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 18, fontWeight: 800 }}>Round HQ</span>
      </div>

      {!activeRound ? (
        <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', padding: '32px 20px', textAlign: 'center' }}>
          <p style={{ fontSize: 32, marginBottom: 10 }}>⛳</p>
          <p style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 16, fontWeight: 800, marginBottom: 8 }}>
            No active round
          </p>
          <p style={{ fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13, lineHeight: 1.5, marginBottom: 18 }}>
            Round HQ is the organiser&apos;s live command centre for today&apos;s round.
            It fills in once a round begins.
          </p>
          <Link
            href={`/trips/${tripId}`}
            style={{
              display: 'inline-block', padding: '10px 20px', borderRadius: 10,
              background: '#14532d', color: '#fff', fontFamily: 'var(--font-body)',
              fontSize: 13.5, fontWeight: 700, textDecoration: 'none',
            }}
          >
            Go to Rounds →
          </Link>
        </div>
      ) : (
        <TournamentControl tripId={tripId} roundId={activeRound.id} roundStatus={activeRound.status} />
      )}
    </div>
  )
}
