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

  // Between rounds (R1/R2 complete, R3 not yet begun), no round has
  // status 'active' — the old fallback of rounds?.[0] picked the
  // latest-play_date row from this DESC-ordered list, which between
  // rounds is always the upcoming round itself, showing an empty
  // "0 players / no scores" board instead of the cumulative standings
  // players actually want to see. LiveLeaderboard already computes full
  // cumulative standings (R1, R2, ... TOTAL) for whatever round it's
  // given — R2 here isn't "the wrong round shown by mistake", it's the
  // correct source for "standings as of the last completed round".
  // Round 3 only becomes the board once it actually has status
  // 'active' (i.e. Begin Round has run) — this fix doesn't touch that
  // transition at all, only what's shown in the gap before it.
  const activeRound = rounds?.find(r => r.status === 'active')
  const lastCompletedRound = rounds?.find(r => r.status === 'completed') // rounds is already play_date DESC, so the first completed match is the most recent
  const round = activeRound ?? lastCompletedRound ?? rounds?.[0]

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
              {round.status === 'completed'
                ? `Current standings through ${round.name}`
                : `Showing ${round.name} (not currently live)`}
            </div>
          )}
          <LiveLeaderboard tripId={tripId} roundId={round.id} roundStatus={round.status} />
        </div>
      )}
    </div>
  )
}
