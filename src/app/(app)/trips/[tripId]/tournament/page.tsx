import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import TournamentControl from '@/components/scoring/TournamentControl'
import AdminScoreOverridePanel from '@/components/scoring/AdminScoreOverridePanel'
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

  // ── Organiser "no active round" state — post-round navigation ──────────
  // `rounds` above is sorted DESC by play_date (existing query), which is
  // fine for `upcomingRound`/`completedRounds` as already used for the
  // player-facing `focusRound` fallback, but for "which round comes next"
  // specifically we need the true chronological order: the soonest
  // upcoming round by play_date, and the most recently completed one.
  // Computed locally here, ascending, rather than reusing/mutating the
  // existing DESC-ordered variables those other call sites depend on.
  const roundsAscending = [...(rounds ?? [])].sort((a, b) => a.play_date.localeCompare(b.play_date))
  const mostRecentlyCompletedRound = [...roundsAscending].reverse().find(r => r.status === 'completed')
  const nextUpcomingRound = roundsAscending.find(r => r.status === 'upcoming')
  const eventFullyComplete = !activeRound && !nextUpcomingRound && completedRounds.length > 0

  // "Organiser who is also playing" — reuses the trip's existing
  // organiser_is_playing flag (the same signal this app has used for
  // this exact question since Sprint 5C.2), not a new per-round check.
  const { data: tripRow } = await supabase.from('trips').select('organiser_is_playing').eq('id', tripId).maybeSingle()
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
          {nextUpcomingRound ? (
            // A round has just closed and another is ready — the
            // "post-round" multi-round journey. mostRecentlyCompletedRound
            // and nextUpcomingRound are both resolved dynamically above
            // from actual round data (by play_date, by status), never
            // hard-coded — this reads correctly whether the trip's rounds
            // are named "Round 1"/"Round 2" or something custom like
            // "Final Round" (exactly the case in this trip's own test
            // data), since it uses each round's own name throughout.
            <>
              <p style={{ fontSize: 32, marginBottom: 10 }}>🏁</p>
              <p style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 16, fontWeight: 800, marginBottom: 8 }}>
                {mostRecentlyCompletedRound?.name ?? 'Round'} Complete
              </p>
              <p style={{ fontFamily: 'var(--font-body)', color: '#14532d', fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>
                {nextUpcomingRound.name} is ready when you are.
              </p>
              <p style={{ fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13, lineHeight: 1.5, marginBottom: 18 }}>
                {mostRecentlyCompletedRound?.name ?? 'The previous round'} has been closed and results are locked in.
                Review your groups and handicaps, then begin the next round.
              </p>
              {/* Deep-links directly to the trip's Rounds tab (?tab=rounds,
                  handled in TripDetailClient) — not the trip Overview —
                  where Round 1 shows Completed / View Results and Round 2
                  shows Upcoming / Begin Round, per the explicit
                  requirement. Reuses the app's existing tab mechanism. */}
              <Link
                href={`/trips/${tripId}?tab=rounds`}
                style={{
                  display: 'inline-block', padding: '10px 20px', borderRadius: 10,
                  background: '#14532d', color: '#fff', fontFamily: 'var(--font-body)',
                  fontSize: 13.5, fontWeight: 700, textDecoration: 'none',
                }}
              >
                Go to {nextUpcomingRound.name} →
              </Link>
            </>
          ) : eventFullyComplete ? (
            // Every round is done and none remain — the event-complete /
            // final-results state, distinct from both the pre-event
            // empty state below and the "next round ready" state above.
            // Per the explicit instruction, this does NOT show a
            // "Go to Round" CTA at all. Now links to the dedicated Final
            // Event Results experience (trophy/champion/podium/round
            // winners/leaderboard) rather than the plain leaderboard —
            // this is the primary CTA once the event is complete, per
            // Sprint 8's explicit "🏆 EVENT COMPLETE / View Final
            // Results →" requirement. Round history, Story, Moments and
            // scorecards all remain reachable via the trip's normal tabs
            // underneath — nothing here removes or hides them.
            <>
              <p style={{ fontSize: 32, marginBottom: 10 }}>🏆</p>
              <p style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 16, fontWeight: 800, marginBottom: 8 }}>
                Event Complete
              </p>
              <p style={{ fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13, lineHeight: 1.5, marginBottom: 18 }}>
                All rounds have been played and results are locked in.
              </p>
              <Link
                href={`/trips/${tripId}/results`}
                style={{
                  display: 'inline-block', padding: '10px 20px', borderRadius: 10,
                  background: '#14532d', color: '#fff', fontFamily: 'var(--font-body)',
                  fontSize: 13.5, fontWeight: 700, textDecoration: 'none',
                }}
              >
                View Final Results →
              </Link>
            </>
          ) : (
            // Pre-event / nothing to reference yet — the original,
            // unchanged empty state (round count is 0 or every round is
            // still upcoming with none ever having started).
            <>
              <p style={{ fontSize: 32, marginBottom: 10 }}>⛳</p>
              <p style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 16, fontWeight: 800, marginBottom: 8 }}>
                No active round
              </p>
              <p style={{ fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13, lineHeight: 1.5, marginBottom: 18 }}>
                My HQ is the organiser&apos;s live command centre for today&apos;s round.
                It fills in once a round begins.
              </p>
              <Link
                href={`/trips/${tripId}?tab=rounds`}
                style={{
                  display: 'inline-block', padding: '10px 20px', borderRadius: 10,
                  background: '#14532d', color: '#fff', fontFamily: 'var(--font-body)',
                  fontSize: 13.5, fontWeight: 700, textDecoration: 'none',
                }}
              >
                Go to Rounds →
              </Link>
            </>
          )}
        </div>
      ) : (
        <>
          <TournamentControl tripId={tripId} roundId={activeRound.id} roundStatus={activeRound.status} />

          {/* Priority 4 — My HQ -> active round -> Admin Score Override.
              Deliberately placed as its own clearly-separated section,
              not folded into TournamentControl itself — this is an
              occasional emergency tool (lost phone, dispute,
              reconciliation deadlock), not part of the normal live-
              scoring narrative TournamentControl shows every visit. */}
          <div style={{ marginTop: 20 }}>
            <div style={{ height: 1, background: '#eceae3', marginBottom: 16 }} />
            <AdminScoreOverridePanel tripId={tripId} roundId={activeRound.id} />
          </div>

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
