import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import LiveLeaderboard from '@/components/scoring/LiveLeaderboard'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface Props { params: Promise<{ tripId: string }> }

export default async function LeaderboardPage({ params }: Props) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: rounds } = await supabase
    .from('rounds')
    .select('id, name, status, play_date')
    .eq('trip_id', tripId)
    .order('play_date', { ascending: false })

  const activeRound = rounds?.find(r => r.status === 'active')
  const round = activeRound ?? rounds?.[0]

  return (
    <div style={{ minHeight: '100vh', background: '#faf9f6', padding: '16px 16px 90px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Link href={`/trips/${tripId}`} style={{ color: '#9ca3af', fontSize: 18, textDecoration: 'none' }}>←</Link>
        <span style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 18, fontWeight: 800 }}>Leaderboard</span>
      </div>

      {!round ? (
        <div style={{ textAlign: 'center', padding: '40px 16px', fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13 }}>
          No rounds yet — the leaderboard appears once a round begins.
        </div>
      ) : (
        <div>
          {!activeRound && (
            <div style={{ marginBottom: 12, fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
              Showing {round.name} (not currently live)
            </div>
          )}
          <LiveLeaderboard tripId={tripId} roundId={round.id} roundStatus={round.status} />
        </div>
      )}
    </div>
  )
}
