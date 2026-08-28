import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import MyHQClient from '@/components/scoring/MyHQClient'
import AdminScoreOverridePanel from '@/components/scoring/AdminScoreOverridePanel'
import MyRoundClient from '@/components/scoring/MyRoundClient'
import EventCountdown from '@/components/trips/EventCountdown'
import { resolveFocusRound, sortRoundsChronologically, getRoundDisplayName } from '@/lib/scoring/multiRound'

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

  // Package 2 — setup_released added to this select. Wrapped with a
  // fallback matching this project's established resilience pattern
  // (page.tsx's own multi-branch fallback for exactly this class of
  // "migration not yet applied" issue) — a query for a column that
  // doesn't exist yet would otherwise throw and break the entire My
  // Round/My HQ page, not just silently omit the field.
  // P0 fix — round-numbering corruption. This used to select rounds
  // without created_at, and sort with a plain play_date-only comparator
  // with no tiebreaker at all — exactly the "arbitrary order when two
  // rounds share a date, no stable secondary key" bug
  // sortRoundsChronologically's own header comment documents as the
  // root cause of a near-identical bug found earlier. Now selects
  // created_at and uses the canonical sorter, and every round's
  // DISPLAYED name below is derived from its actual chronological
  // position via getRoundDisplayName, not trusted from the stored
  // `name` column — which can legitimately disagree with position the
  // moment a round is added whose date falls before an existing
  // round's date (the exact reported case).
  let rounds: { id: string; name: string; status: string; play_date: string; created_at: string; course_name: string | null; tee_time: string | null; holes: number; scoring_format: string; tee_name: string | null; setup_released?: boolean }[] | null = null
  {
    const roundsRes = await supabase
      .from('rounds')
      .select('id, name, status, play_date, created_at, course_name, tee_time, holes, scoring_format, tee_name, setup_released')
      .eq('trip_id', tripId)
      .order('play_date', { ascending: false })
    if (roundsRes.error) {
      console.warn('[tournament page] setup_released column missing — run 062_round_setup_released.sql in Supabase SQL Editor')
      const fallbackRes = await supabase
        .from('rounds')
        .select('id, name, status, play_date, created_at, course_name, tee_time, holes, scoring_format, tee_name')
        .eq('trip_id', tripId)
        .order('play_date', { ascending: false })
      rounds = (fallbackRes.data ?? []).map(r => ({ ...r, setup_released: false }))
    } else {
      rounds = roundsRes.data
    }
  }

  const activeRound = rounds?.find(r => r.status === 'active')
  // rounds is fetched DESC by play_date (line 31) — completedRounds
  // below only ever uses .length, so that ordering doesn't matter here;
  // the actual "most recent" lookup is mostRecentlyCompletedRound,
  // computed from the chronologically-sorted copy further down.
  const completedRounds = (rounds ?? []).filter(r => r.status === 'completed')
  const roundsAscendingRaw = sortRoundsChronologically(rounds ?? [])
  // Every consumer of roundsAscending gets the corrected display name
  // baked in here, once — not each screen re-deriving it independently.
  const roundsAscending = roundsAscendingRaw.map(r => ({ ...r, name: getRoundDisplayName(r, roundsAscendingRaw) }))
  const mostRecentlyCompletedRound = [...roundsAscending].reverse().find(r => r.status === 'completed')
  const nextUpcomingRound = roundsAscending.find(r => r.status === 'upcoming')
  const eventFullyComplete = !activeRound && !nextUpcomingRound && completedRounds.length > 0

  // Players want the most relevant round regardless of active/upcoming/
  // completed (matching PlayerHomeCard's same logic — also fixed in
  // this same change, see below). Organisers only ever look at the
  // active round in My HQ, unaffected by this fix.
  const focusRound = resolveFocusRound(activeRound, mostRecentlyCompletedRound, nextUpcomingRound)

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
          <span style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 18, fontWeight: 800 }}>My Golf</span>
        </div>
        {!focusRound ? (
          <div style={{ textAlign: 'center', padding: '40px 16px', fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13 }}>
            No rounds yet — your organiser hasn&apos;t set one up.
          </div>
        ) : (
          <MyRoundClient
            tripId={tripId} rounds={roundsAscending} defaultRoundId={focusRound.id}
          />
        )}
      </div>
    )
  }

  // ── Organiser: My HQ — Event Schedule is now the actual round
  // selector (P0 field-test fix, see MyHQClient.tsx for the full trace),
  // so the detailed dashboard below no longer disappears once Round 1
  // completes and Round 2 becomes the active round. ─────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#faf9f6', padding: '16px 16px 90px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Link href={`/trips/${tripId}`} style={{ color: '#9ca3af', fontSize: 18, textDecoration: 'none' }}>←</Link>
        <span style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 18, fontWeight: 800 }}>My HQ</span>
      </div>

      {/* My HQ Countdown — deliberately still tied to focusRound (the
          event's own "what's coming up next" signal), not to whichever
          round the organiser happens to have selected below — those are
          two different questions. Unaffected by the round-selector fix. */}
      {focusRound && <EventCountdown tripId={tripId} round={focusRound} />}

      <MyHQClient
        tripId={tripId}
        rounds={roundsAscending}
        defaultRoundId={focusRound?.id ?? null}
        organiserIsPlaying={organiserIsPlaying}
        mostRecentlyCompletedRoundId={mostRecentlyCompletedRound?.id ?? null}
        mostRecentlyCompletedRoundName={mostRecentlyCompletedRound?.name ?? null}
        nextUpcomingRoundId={nextUpcomingRound?.id ?? null}
        nextUpcomingRoundName={nextUpcomingRound?.name ?? null}
        eventFullyComplete={eventFullyComplete}
      />

      {/* Item 3 — Score Management. Deliberately outside MyHQClient's own
          round-selector scope — this already had its own independent
          round selector inside AdminScoreOverridePanel and covers every
          live/completed round at once, not just whichever one is
          currently selected above. Unaffected by this fix. */}
      {(rounds ?? []).some(r => r.status === 'active' || r.status === 'completed') && (
        <div id="score-management" style={{ marginTop: 20 }}>
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
