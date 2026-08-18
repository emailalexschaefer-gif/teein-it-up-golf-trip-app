import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import LiveLeaderboard from '@/components/scoring/LiveLeaderboard'
import TheField from '@/components/scoring/TheField'
import { selectLeaderboardRound } from '@/lib/scoring/multiRound'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface Props { params: Promise<{ tripId: string }> }

export default async function LeaderboardPage({ params }: Props) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: rawRounds } = await supabase
    .from('rounds')
    .select('id, name, status, play_date, created_at')
    .eq('trip_id', tripId)

  // Root cause of "Leaderboard still shows Round 1" even after later
  // rounds complete: this query previously ordered by play_date alone
  // (`.order('play_date', { ascending: false })`), with no deterministic
  // tiebreaker. Rounds created together at trip setup (a single multi-
  // row INSERT) can share an identical play_date if the organiser picked
  // the same calendar date for both — exactly Darren's own "two rounds
  // created at the same timestamp" test case — and a single-column
  // ORDER BY gives no guaranteed, stable order among ties. Depending on
  // query-plan happenstance, this could non-deterministically select
  // Round 1 instead of Round 2 as "the most recent completed round."
  //
  // This is the EXACT bug class already found and fixed in the
  // leaderboard API route (see that file's own "R2 LIVE shows R1 data"
  // comment). selectLeaderboardRound (src/lib/scoring/multiRound.ts,
  // now unit-tested) wraps the same already-proven
  // sortRoundsChronologically tiebreaker (play_date, then created_at,
  // then id) rather than re-solving the same problem a second way.
  const round = selectLeaderboardRound((rawRounds ?? []) as { id: string; name: string; status: string; play_date: string; created_at: string }[])
  const activeRound = round?.status === 'active' ? round : undefined

  return (
    <div style={{ minHeight: '100vh', background: '#faf9f6', padding: '16px 16px 90px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Link href={`/trips/${tripId}`} style={{ color: '#9ca3af', fontSize: 18, textDecoration: 'none' }}>←</Link>
        <span style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 18, fontWeight: 800 }}>Leaderboard</span>
      </div>

      {!round || round.status === 'upcoming' ? (
        // Pre-event state — no round yet, or a round exists but hasn't
        // started (no scores to show). Previously this rendered
        // negative dead-screen text ("No rounds yet...", "not currently
        // live") — replaced with The Field, which uses the same player
        // roster data the app already has rather than saying nothing's
        // available yet.
        <TheField tripId={tripId} />
      ) : (
        <div>
          {!activeRound && (
            <div style={{ marginBottom: 12, fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
              Current standings through {round.name}
            </div>
          )}
          <LiveLeaderboard tripId={tripId} roundId={round.id} roundStatus={round.status} />
        </div>
      )}
    </div>
  )
}
