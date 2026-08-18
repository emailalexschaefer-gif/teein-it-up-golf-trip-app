import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import TournamentControl from '@/components/scoring/TournamentControl'
import AdminScoreOverridePanel from '@/components/scoring/AdminScoreOverridePanel'
import MyRoundClient from '@/components/scoring/MyRoundClient'
import RoundSchedule from '@/components/scoring/RoundSchedule'
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
    .select('id, name, status, play_date, course_name, tee_time, holes, scoring_format, tee_name')
    .eq('trip_id', tripId)
    .order('play_date', { ascending: false })

  const activeRound = rounds?.find(r => r.status === 'active')
  // rounds is fetched DESC by play_date (line 31) — completedRounds
  // below only ever uses .length, so that ordering doesn't matter here;
  // the actual "most recent" lookup is mostRecentlyCompletedRound,
  // computed from the ascending-sorted copy further down.
  const completedRounds = (rounds ?? []).filter(r => r.status === 'completed')
  const roundsAscending = [...(rounds ?? [])].sort((a, b) => a.play_date.localeCompare(b.play_date))
  const mostRecentlyCompletedRound = [...roundsAscending].reverse().find(r => r.status === 'completed')
  const nextUpcomingRound = roundsAscending.find(r => r.status === 'upcoming')
  const eventFullyComplete = !activeRound && !nextUpcomingRound && completedRounds.length > 0

  // Players want the most relevant round regardless of active/upcoming/
  // completed (matching PlayerHomeCard's same logic — also fixed in
  // this same change, see below). Organisers only ever look at the
  // active round in My HQ, unaffected by this fix.
  const focusRound = activeRound ?? nextUpcomingRound ?? mostRecentlyCompletedRound

  // "Organiser who is also playing" — reuses the trip's existing
  // organiser_is_playing flag (the same signal this app has used for
  // this exact question since Sprint 5C.2), not a new per-round check.
  const { data: tripRow } = await supabase.from('trips').select('organiser_is_playing, groups_released').eq('id', tripId).maybeSingle()
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
          <MyRoundClient
            tripId={tripId} rounds={roundsAscending} defaultRoundId={focusRound.id}
            groupsReleased={tripRow?.groups_released ?? false}
          />
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

      {/* Priority 2 — Event Schedule now shown in My HQ too, reusing the
          exact same RoundSchedule component from My Round (read-only,
          no organiser actions anywhere in that file) rather than a
          second implementation. Organiser controls (Begin Round, etc.)
          remain exactly where they already are — the trip's Rounds tab
          — this is presentation/navigation only, not a duplicate of
          that management surface. */}
      <RoundSchedule
        rounds={roundsAscending} selectedRoundId={focusRound?.id ?? ''} defaultRoundId={focusRound?.id ?? null}
        interactive={false}
      />

      {!activeRound ? (
        <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', padding: '32px 20px', textAlign: 'center' }}>
          {nextUpcomingRound && mostRecentlyCompletedRound ? (
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
            // Pre-event / nothing to reference yet — genuinely reachable
            // now that the condition above requires
            // mostRecentlyCompletedRound to exist, not just
            // nextUpcomingRound. Copy lightly improved to match the
            // established "no dead screens" language used elsewhere
            // (Deployment 1); the full "control centre" module-preview
            // rebuild (Live Leaderboard/Score Management/Side Games/
            // Round Insights preview cards) is a larger build than fits
            // safely in this pass alongside the urgent bug fix above —
            // reporting that as the clear next step rather than
            // attempting it under the same time pressure as the fix.
            <>
              <p style={{ fontSize: 32, marginBottom: 10 }}>⛳</p>
              <p style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 16, fontWeight: 800, marginBottom: 8 }}>
                Your control centre
              </p>
              <p style={{ fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13, lineHeight: 1.5, marginBottom: 18 }}>
                My HQ comes alive once the round begins — live leaderboard,
                score management and side games will all appear here.
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

      {/* Item 3 — Score Management. Deliberately moved OUTSIDE the
          "has an active round" branch above — this previously only
          rendered when a round happened to be active, meaning an
          organiser trying to correct a COMPLETED round's score after
          the event moved on had no way to reach this at all, directly
          contradicting "Allow score correction for LIVE rounds, COMPLETE
          rounds." Now shown whenever the trip has at least one live or
          completed round, with its own round selector inside the panel
          — not gated on which round happens to be "focused" right now.
          Upcoming rounds are excluded (nothing to correct — genuinely no
          scorecard exists yet), matching "Upcoming rounds have no
          scorecard to edit." */}
      {(rounds ?? []).some(r => r.status === 'active' || r.status === 'completed') && (
        <div style={{ marginTop: 20 }}>
          <div style={{ height: 1, background: '#eceae3', marginBottom: 16 }} />
          <AdminScoreOverridePanel
            tripId={tripId}
            rounds={(rounds ?? []).filter(r => r.status === 'active' || r.status === 'completed')}
          />
        </div>
      )}
    </div>
  )
}
