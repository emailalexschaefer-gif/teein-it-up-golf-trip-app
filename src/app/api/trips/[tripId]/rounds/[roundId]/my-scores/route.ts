/**
 * GET /api/trips/[tripId]/rounds/[roundId]/my-scores
 *
 * Lightweight polling endpoint for SelfMarkerScoreShell's live refresh.
 * Returns exactly the same shape page.tsx resolves server-side on first
 * load (myScorecard, markedScorecard, markedByName, round status) — this
 * route exists so the client can re-fetch that same data on an interval /
 * window-focus / reconnect, without a full page navigation, which was the
 * root cause of scores and reconciliation status going stale until the
 * user left and re-entered the round.
 *
 * Mirrors src/app/(app)/trips/[tripId]/rounds/[roundId]/page.tsx's
 * self_and_marker resolution logic exactly — same queries, same group
 * membership merge (the same PostgREST-embed pitfall applies here: there is
 * no FK from scorecards to trip_members, so it's fetched separately).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// This is a polling endpoint (SelfMarkerScoreShell hits it every ~7s while a
// round is active) — it must never be cached. Without this, Next.js can
// treat a GET route handler as cacheable, meaning repeated polls could keep
// re-serving one stale response instead of hitting Supabase fresh. That
// would look exactly like "the other player's score doesn't appear until
// you leave and re-enter" even though the client-side polling is firing
// correctly — the cache, not the polling, would be the actual fault.
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

interface ScoreEntryRow {
  hole_id: string
  gross_score: number
  stableford_pts: number
  is_no_return: boolean
  capture_role: 'self' | 'marker'
  entered_by: string
  admin_overridden: boolean
}

interface ScorecardProfile {
  id: string
  full_name: string
  avatar_url: string | null
}

interface ScorecardRow {
  id: string
  player_id: string
  playing_handicap: number
  status: string
  profiles: ScorecardProfile | null
  score_entries: ScoreEntryRow[]
}

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const memberCheck = await admin
    .from('trip_members')
    .select('id, role, group_id')
    .eq('trip_id', tripId)
    .eq('profile_id', user.id)
    .maybeSingle()

  if (!memberCheck.data) {
    return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })
  }

  const roundRes = await admin
    .from('rounds')
    .select('id, status, score_capture_mode')
    .eq('id', roundId)
    .eq('trip_id', tripId)
    .maybeSingle()

  if (!roundRes.data) {
    return NextResponse.json({ error: 'Round not found.' }, { status: 404 })
  }
  const round = roundRes.data

  // group_scorer mode uses a different shell (ScoreSessionShell) with its
  // own data flow — this polling endpoint is specifically for the
  // self+marker / individual model.
  if (round.score_capture_mode === 'group_scorer') {
    return NextResponse.json({ error: 'Not applicable for group_scorer mode.' }, { status: 400 })
  }

  // Same PostgREST-embed pitfall as page.tsx: no FK from scorecards to
  // trip_members, so group membership is fetched separately and merged in
  // application code rather than embedded in the same query.
  const allCardsRes = await admin
    .from('scorecards')
    .select(`
      id, player_id, playing_handicap, status, submitted_at,
      profiles:player_id ( id, full_name, avatar_url ),
      score_entries ( hole_id, gross_score, stableford_pts, is_no_return, capture_role, entered_by, admin_overridden )
    `)
    .eq('round_id', roundId)
    .neq('status', 'withdrawn')

  if (allCardsRes.error) {
    console.error('[my-scores] scorecards query failed', { roundId, tripId, error: allCardsRes.error })
    return NextResponse.json({ error: 'Could not load scores.' }, { status: 500 })
  }

  const allCards: ScorecardRow[] = allCardsRes.data ?? []
  const myCard = allCards.find((c) => c.player_id === user.id) ?? null

  const usesMarkers = round.score_capture_mode === 'self_and_marker'
  let markedByProfile: ScorecardProfile | null = null
  let markedCard: ScorecardRow | null = null

  if (usesMarkers) {
    const markersRes = await admin
      .from('round_markers')
      .select('player_id, marker_player_id')
      .eq('round_id', roundId)

    const markerRows: Array<{ player_id: string; marker_player_id: string }> = markersRes.data ?? []
    const markedByRow = markerRows.find((r) => r.player_id === user.id)
    const iMarkRow = markerRows.find((r) => r.marker_player_id === user.id)

    markedByProfile = markedByRow
      ? allCards.find((c) => c.player_id === markedByRow.marker_player_id)?.profiles ?? null
      : null
    markedCard = iMarkRow
      ? allCards.find((c) => c.player_id === iMarkRow.player_id) ?? null
      : null
  }

  // Score Management redesign — audit detail for the "⚙️ Organiser
  // Override" indicator and its expandable "Resolved by organiser" view.
  // Fetched for BOTH myCard and markedCard — the brief is explicit that
  // "both the impacted player and their playing partner should be able
  // to understand why the number changed," and when the partner
  // (marker) opens their own /my-scores, THEIR myCard is their own card,
  // not the player's — the audit trail for the overridden hole only
  // exists on the player's card (markedCard from the marker's point of
  // view), so it has to be fetched separately here or the marker would
  // never see it at all. Old/new gross, reason, who, when — the
  // marker's own value at time of override isn't stored separately here
  // since it's already directly readable from markedCard/myScorecard's
  // own score_entries (capture_role='marker') the response already
  // includes — no duplicate copy of that value.
  async function fetchOverrideAudit(cardId: string) {
    const auditRes = await admin
      .from('score_override_audit')
      .select('hole_id, old_gross_score, new_gross_score, reason, overridden_at, profiles:overridden_by ( full_name )')
      .eq('scorecard_id', cardId)
      .order('overridden_at', { ascending: false })
    return ((auditRes.data ?? []) as unknown as { hole_id: string; old_gross_score: number | null; new_gross_score: number; reason: string; overridden_at: string; profiles: { full_name: string } | null }[])
      .map(a => ({ holeId: a.hole_id, oldGrossScore: a.old_gross_score, newGrossScore: a.new_gross_score, reason: a.reason, overriddenByName: a.profiles?.full_name ?? 'Organiser', overriddenAt: a.overridden_at }))
  }
  const myOverrideAudit = myCard ? await fetchOverrideAudit(myCard.id) : []
  const markedOverrideAudit = markedCard ? await fetchOverrideAudit(markedCard.id) : []

  return NextResponse.json({
    round: { id: round.id, status: round.status },
    myScorecard: myCard,
    markedScorecard: markedCard,
    markedByName: markedByProfile?.full_name ?? null,
    myOverrideAudit,
    markedOverrideAudit,
  })
}
