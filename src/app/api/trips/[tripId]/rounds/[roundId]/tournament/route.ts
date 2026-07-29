/**
 * GET /api/trips/[tripId]/rounds/[roundId]/tournament
 *
 * Organiser-facing aggregation for Round HQ. Not a
 * duplicate of the leaderboard route — that returns a ranked player list;
 * this returns group-level operational state (current hole, reconciliation
 * status, alerts) that the leaderboard was never meant to answer. Built on
 * the exact same underlying query shape and the same capture_role='self'
 * convention the leaderboard route already established.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

interface ScoreEntryRow {
  hole_id: string; gross_score: number | null; stableford_pts: number
  is_no_return: boolean; capture_role: string; entered_at: string
}
interface ScorecardRow {
  id: string; player_id: string; status: string
  profiles: { full_name: string } | null
  score_entries: ScoreEntryRow[]
}
interface HoleRow { id: string; hole_number: number; par: number }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const memberCheck = await admin.from('trip_members').select('role')
    .eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberCheck.data || memberCheck.data.role !== 'organiser') {
    return NextResponse.json({ error: 'Organiser only.' }, { status: 403 })
  }

  const roundRes = await admin.from('rounds')
    .select('id, name, holes, status, scoring_format, score_capture_mode')
    .eq('id', roundId).eq('trip_id', tripId).maybeSingle()
  if (!roundRes.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })
  const totalHoles: number = roundRes.data.holes ?? 18
  const isMarkerMode = roundRes.data.score_capture_mode === 'self_and_marker'

  const holesRes = await admin.from('holes').select('id, hole_number, par').eq('round_id', roundId)
  const holeByNumber = new Map<number, HoleRow>((holesRes.data ?? []).map((h: HoleRow) => [h.hole_number, h]))

  const groupsRes = await admin.from('trip_groups').select('id, name, sort_order').eq('trip_id', tripId).order('sort_order')

  const scRes = await admin.from('scorecards')
    .select(`
      id, player_id, status,
      profiles:player_id ( full_name ),
      score_entries ( hole_id, gross_score, stableford_pts, is_no_return, capture_role, entered_at )
    `)
    .eq('round_id', roundId)
    .neq('status', 'withdrawn')

  if (scRes.error) {
    console.error('[tournament]', scRes.error)
    return NextResponse.json({ error: 'Could not load tournament data.' }, { status: 500 })
  }

  // Separate query for group assignment — scorecards.player_id has no FK to
  // trip_members (it references profiles directly), so this can't be
  // embedded in the scorecards select above; merged in JS instead. This is
  // the identical fix already applied earlier in this project for the same
  // class of bug on the trip detail page.
  const tmRes = await admin.from('trip_members').select('profile_id, group_id').eq('trip_id', tripId)
  const groupIdByProfile = new Map<string, string | null>((tmRes.data ?? []).map((m: { profile_id: string; group_id: string | null }) => [m.profile_id, m.group_id]))

  // Build a hole_id -> hole_number lookup (score_entries reference hole_id,
  // not hole_number directly) so mismatch/stat logic below can key by
  // hole number cleanly.
  const holeNumberById = new Map<string, number>((holesRes.data ?? []).map((h: HoleRow) => [h.id, h.hole_number]))

  interface PlayerState {
    name: string; holesPlayed: number; finished: boolean
    hasMismatch: boolean; waitingForMarker: boolean; groupId: string | null
  }

  const players: PlayerState[] = ((scRes.data ?? []) as ScorecardRow[]).map((sc) => {
    const selfByHole = new Map<number, ScoreEntryRow>()
    const markerByHole = new Map<number, ScoreEntryRow>()
    for (const e of sc.score_entries ?? []) {
      const hn = holeNumberById.get(e.hole_id)
      if (hn === undefined) continue
      if (e.capture_role === 'self') selfByHole.set(hn, e)
      else if (e.capture_role === 'marker') markerByHole.set(hn, e)
    }
    const holesPlayed = selfByHole.size
    let hasMismatch = false
    let waitingForMarker = false
    if (isMarkerMode) {
      for (const [hn, self] of selfByHole) {
        const marker = markerByHole.get(hn)
        if (!marker) { waitingForMarker = true; continue }
        const differs = self.is_no_return !== marker.is_no_return
          || (!self.is_no_return && self.gross_score !== marker.gross_score)
        if (differs) hasMismatch = true
      }
    }
    return {
      name: sc.profiles?.full_name ?? 'Player',
      holesPlayed,
      finished: holesPlayed >= totalHoles,
      hasMismatch,
      waitingForMarker,
      groupId: groupIdByProfile.get(sc.player_id) ?? null,
    }
  })

  // ── Group progress ──────────────────────────────────────────────────────
  const groups = ((groupsRes.data ?? []) as { id: string; name: string }[]).map((g) => {
    const members = players.filter(p => p.groupId === g.id)
    const active = members.filter(p => !p.finished)
    const currentHole = active.length > 0 ? Math.min(...active.map(p => p.holesPlayed)) + 1 : totalHoles
    const anyMismatch = members.some(p => p.hasMismatch)
    const anyWaiting = members.some(p => p.waitingForMarker)
    const allFinished = members.length > 0 && members.every(p => p.finished)

    let status: 'scoring' | 'waiting' | 'reconciliation' | 'finished' | 'needs_attention' = 'scoring'
    if (allFinished) status = 'finished'
    else if (anyMismatch) status = 'reconciliation'
    else if (anyWaiting) status = 'waiting'
    // "Needs attention": a group with players active but genuinely stuck —
    // nobody has played a single hole yet despite the round being active.
    else if (active.length > 0 && active.every(p => p.holesPlayed === 0) && roundRes.data.status === 'active') status = 'needs_attention'

    return {
      groupId: g.id, groupName: g.name, playerCount: members.length,
      currentHole, status,
      players: members.map(p => ({ name: p.name, holesPlayed: p.holesPlayed, finished: p.finished, hasMismatch: p.hasMismatch, waitingForMarker: p.waitingForMarker })),
    }
  })

  // ── Alerts (current actionable state, not a history log) ───────────────
  const alerts: { severity: 'red' | 'gold' | 'green' | 'grey'; text: string }[] = []
  for (const g of groups) {
    if (g.status === 'reconciliation') alerts.push({ severity: 'red', text: `${g.groupName}: score mismatch needs review` })
    if (g.status === 'needs_attention') alerts.push({ severity: 'red', text: `${g.groupName}: no scores entered yet` })
    if (g.status === 'waiting') alerts.push({ severity: 'gold', text: `${g.groupName}: waiting on marker entries` })
    if (g.status === 'finished') alerts.push({ severity: 'green', text: `${g.groupName}: finished, all scores matched` })
  }
  if (alerts.length === 0) alerts.push({ severity: 'green', text: 'No issues — tournament running smoothly' })

  // ── Timeline — genuinely from entered_at, most recent first ─────────────
  const timelineEntries: { text: string; at: string }[] = []
  for (const sc of (scRes.data ?? []) as ScorecardRow[]) {
    for (const e of sc.score_entries ?? []) {
      if (e.capture_role !== 'self') continue
      const hn = holeNumberById.get(e.hole_id)
      if (hn === undefined) continue
      timelineEntries.push({ text: `${sc.profiles?.full_name ?? 'Player'} confirmed Hole ${hn}`, at: e.entered_at })
    }
  }
  timelineEntries.sort((a, b) => b.at.localeCompare(a.at))

  // ── Live stats — real, from actual gross_score vs par ───────────────────
  let birdies = 0, pars = 0, bogeys = 0, totalPts = 0
  const holeAverages = new Map<number, { sum: number; count: number }>()
  for (const sc of (scRes.data ?? []) as ScorecardRow[]) {
    for (const e of sc.score_entries ?? []) {
      if (e.capture_role !== 'self' || e.is_no_return || e.gross_score === null) continue
      const hn = holeNumberById.get(e.hole_id)
      const hole = hn !== undefined ? holeByNumber.get(hn) : undefined
      if (!hole) continue
      const diff = e.gross_score - hole.par
      if (diff <= -1) birdies++
      else if (diff === 0) pars++
      else if (diff === 1) bogeys++
      totalPts += e.stableford_pts ?? 0
      const agg = holeAverages.get(hn as number) ?? { sum: 0, count: 0 }
      agg.sum += e.stableford_pts ?? 0
      agg.count += 1
      holeAverages.set(hn as number, agg)
    }
  }
  let bestHole: { number: number; avgPts: number } | null = null
  let hardestHole: { number: number; avgPts: number } | null = null
  for (const [hn, agg] of holeAverages) {
    const avg = agg.sum / agg.count
    if (!bestHole || avg > bestHole.avgPts) bestHole = { number: hn, avgPts: Math.round(avg * 10) / 10 }
    if (!hardestHole || avg < hardestHole.avgPts) hardestHole = { number: hn, avgPts: Math.round(avg * 10) / 10 }
  }

  const finishedCount = players.filter(p => p.finished).length
  const scoringNow = players.filter(p => p.holesPlayed > 0 && !p.finished).length
  const awaitingReconciliation = players.filter(p => p.hasMismatch).length
  const totalHolesExpected = players.length * totalHoles
  const totalHolesPlayed = players.reduce((s, p) => s + p.holesPlayed, 0)
  const completionPct = totalHolesExpected > 0 ? Math.round((totalHolesPlayed / totalHolesExpected) * 100) : 0

  let health: { level: 'green' | 'gold' | 'red'; text: string }
  if (awaitingReconciliation > 0) health = { level: 'red', text: `${awaitingReconciliation} reconciliation${awaitingReconciliation === 1 ? '' : 's'} outstanding` }
  else if (groups.some(g => g.status === 'waiting' || g.status === 'needs_attention')) {
    const n = groups.filter(g => g.status === 'waiting' || g.status === 'needs_attention').length
    health = { level: 'gold', text: `${n} group${n === 1 ? '' : 's'} need attention` }
  } else health = { level: 'green', text: 'Tournament running smoothly' }

  return NextResponse.json({
    roundName: roundRes.data.name,
    scoringFormat: roundRes.data.scoring_format,
    roundStatus: roundRes.data.status,
    totalHoles,
    health,
    summary: {
      players: players.length,
      groups: groups.length,
      scoringNow,
      finishedCount,
      awaitingReconciliation,
      completionPct,
    },
    groups,
    alerts,
    timeline: timelineEntries.slice(0, 15),
    stats: {
      birdies, pars, bogeys,
      avgStableford: (() => {
        const activePlayers = players.filter(p => p.holesPlayed > 0).length
        return activePlayers > 0 ? Math.round((totalPts / activePlayers) * 10) / 10 : 0
      })(),
      bestHole, hardestHole,
    },
  })
}
