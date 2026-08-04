import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import TournamentControl from '@/components/scoring/TournamentControl'
import PlayerRoundView from '@/components/scoring/PlayerRoundView'
import MyRoundSummary from '@/components/scoring/MyRoundSummary'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface Props { params: Promise<{ tripId: string }> }

export default async function TournamentPage({ params }: Props) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('trip_members').select('role')
    .eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!membership) redirect(`/trips/${tripId}`)

  const isOrganiser = membership.role === 'organiser'

  const { data: rounds } = await supabase
    .from('rounds')
    .select('id, name, status, play_date')
    .eq('trip_id', tripId)
    .order('play_date', { ascending: false })

  const activeRound = rounds?.find(r => r.status === 'active')
  const upcomingRound = rounds?.find(r => r.status === 'upcoming')
  const completedRounds = (rounds ?? []).filter(r => r.status === 'completed')
  // Players want the most relevant round regardless of active/upcoming/
  // completed (matching PlayerHomeCard's same logic); organisers only
  // ever look at the active round in My HQ, same as before this change.
  const focusRound = activeRound ?? upcomingRound ?? completedRounds[completedRounds.length - 1]

  // "Organiser who is also playing" — reuses the trip's existing
  // organiser_is_playing flag (the same signal this app has used for
  // this exact question since Sprint 5C.2), not a new per-round check.
  const { data: tripRow } = await supabase.from('trips').select('organiser_is_playing, event_type').eq('id', tripId).maybeSingle()
  const organiserIsPlaying = isOrganiser && (tripRow?.organiser_is_playing ?? false)

  if (!isOrganiser) {
    // ── Player: My Round ────────────────────────────────────────────────
    return (
      <div style={{ minHeight: '100vh', background: '#faf9f6', padding: '16px 16px 90px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Link href={`/trips/${tripId}`} style={{ color: '#9ca3af', fontSize: 18, textDecoration: 'none' }}>←</Link>
          <span style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 18, fontWeight: 800 }}>My Round</span>
        </div>
        {!focusRound ? (
          <div style={{ textAlign: 'center', padding: '40px 16px', fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13 }}>
            No rounds yet — your organiser hasn&apos;t set one up.
          </div>
        ) : (
          <PlayerRoundView tripId={tripId} roundId={focusRound.id} roundStatus={focusRound.status} />
        )}
      </div>
    )
  }

  // ── Organiser: My HQ (unchanged), plus a compact My Round section if
  // this organiser is also playing ──────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#faf9f6', padding: '16px 16px 90px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Link href={`/trips/${tripId}`} style={{ color: '#9ca3af', fontSize: 18, textDecoration: 'none' }}>←</Link>
        <span style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 18, fontWeight: 800 }}>My HQ</span>
      </div>

      {!activeRound ? (
        <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', padding: '32px 20px', textAlign: 'center' }}>
          <p style={{ fontSize: 32, marginBottom: 10 }}>⛳</p>
          <p style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 16, fontWeight: 800, marginBottom: 8 }}>
            No active round
          </p>
          <p style={{ fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13, lineHeight: 1.5, marginBottom: 18 }}>
            My HQ is the organiser&apos;s live command centre for today&apos;s round.
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
        <>
          <TournamentControl tripId={tripId} roundId={activeRound.id} roundStatus={activeRound.status} eventType={tripRow?.event_type ?? null} />

          {organiserIsPlaying && (
            <div style={{ marginTop: 20 }}>
              <div style={{ height: 1, background: '#eceae3', marginBottom: 16 }} />
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: '#a1791f', marginBottom: 8 }}>
                My Round
              </div>
              <MyRoundSummary tripId={tripId} roundId={activeRound.id} roundStatus={activeRound.status} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
