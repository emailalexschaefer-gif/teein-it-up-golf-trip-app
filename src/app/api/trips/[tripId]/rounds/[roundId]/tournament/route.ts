/**
 * GET /api/trips/[tripId]/rounds/[roundId]/tournament
 *
 * Organiser-facing aggregation for My HQ. Not a duplicate of the
 * leaderboard route — that returns a ranked player list for players to
 * see; this returns operational + narrative state for the organiser
 * (group progress, alerts, milestone Story, highlights). Built on the
 * same underlying query shape and the same capture_role='self'
 * convention the leaderboard route already established. The leaderboard
 * snapshot below recomputes ranking locally rather than calling that
 * route, since this data is already fetched here for other purposes —
 * an extra network round-trip to itself would be worse, not better.
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

  const holeNumberById = new Map<string, number>((holesRes.data ?? []).map((h: HoleRow) => [h.id, h.hole_number]))
  const scorecards = (scRes.data ?? []) as ScorecardRow[]

  interface PlayerState {
    playerId: string; name: string; holesPlayed: number; finished: boolean
    hasMismatch: boolean; waitingForMarker: boolean; groupId: string | null; totalPts: number
    mismatchDetails: { hn: number; playerScore: string; markerScore: string; at: string }[]
  }

  const players: PlayerState[] = scorecards.map((sc) => {
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
    const mismatchDetails: { hn: number; playerScore: string; markerScore: string; at: string }[] = []
    if (isMarkerMode) {
      for (const [hn, self] of selfByHole) {
        const marker = markerByHole.get(hn)
        if (!marker) { waitingForMarker = true; continue }
        const differs = self.is_no_return !== marker.is_no_return
          || (!self.is_no_return && self.gross_score !== marker.gross_score)
        // Reconciliation trace — per explicit request to instrument the
        // pipeline rather than assume it's working. Logs every compared
        // hole (not just mismatches), so if My HQ and the player's own
        // Round Summary ever disagree again, this shows exactly what the
        // database held at the moment this specific request ran, not an
        // inference from two separate screenshots taken minutes apart.
        console.log('[tournament reconciliation trace]', {
          playerId: sc.player_id, playerName: sc.profiles?.full_name ?? 'Player', hole: hn,
          playerGross: self.is_no_return ? 'no_return' : self.gross_score,
          markerGross: marker.is_no_return ? 'no_return' : marker.gross_score,
          playerEnteredAt: self.entered_at, markerEnteredAt: marker.entered_at,
          comparisonResult: differs ? 'mismatch' : 'matched',
          reviewFlag: differs,
        })
        if (differs) {
          hasMismatch = true
          mismatchDetails.push({
            hn,
            playerScore: self.is_no_return ? 'No return' : String(self.gross_score),
            markerScore: marker.is_no_return ? 'No return' : String(marker.gross_score),
            at: self.entered_at > marker.entered_at ? self.entered_at : marker.entered_at,
          })
        }
      }
    }
    const totalPts = [...selfByHole.values()].reduce((s, e) => s + (e.stableford_pts ?? 0), 0)
    return {
      playerId: sc.player_id,
      name: sc.profiles?.full_name ?? 'Player',
      holesPlayed,
      finished: holesPlayed >= totalHoles,
      hasMismatch,
      waitingForMarker,
      mismatchDetails,
      groupId: groupIdByProfile.get(sc.player_id) ?? null,
      totalPts,
    }
  })

  // Marker names, for the rich alert cards — round_markers links each
  // player to whoever is marking them for this specific round.
  const markersRes = await admin.from('round_markers').select('player_id, marker_player_id').eq('round_id', roundId)
  const nameByProfileId = new Map<string, string>(players.map(p => [p.playerId, p.name]))
  const markerNameByPlayerId = new Map<string, string>(
    (markersRes.data ?? []).map((m: { player_id: string; marker_player_id: string }) => [m.player_id, nameByProfileId.get(m.marker_player_id) ?? 'Marker'])
  )
  const groupNameById = new Map<string, string>(((groupsRes.data ?? []) as { id: string; name: string }[]).map(g => [g.id, g.name]))

  // ── Leaderboard snapshot — top 5, reusing the same ranking rule the
  // leaderboard route uses (points desc, ties by fewer holes played) ──────
  const ranked = [...players].sort((a, b) => b.totalPts - a.totalPts || b.holesPlayed - a.holesPlayed)
  const leaderboardSnapshot = ranked.slice(0, 5).map((p, i) => ({ position: i + 1, playerId: p.playerId, name: p.name, totalPts: p.totalPts, holesPlayed: p.holesPlayed, finished: p.finished }))

  // ── Group progress ──────────────────────────────────────────────────────
  const groups = ((groupsRes.data ?? []) as { id: string; name: string }[]).map((g) => {
    const members = players.filter(p => p.groupId === g.id)
    const active = members.filter(p => !p.finished)
    const currentHole = active.length > 0 ? Math.min(...active.map(p => p.holesPlayed)) + 1 : totalHoles
    const anyMismatch = members.some(p => p.hasMismatch)
    const anyWaiting = members.some(p => p.waitingForMarker)
    const allFinished = members.length > 0 && members.every(p => p.finished)

    let status: 'scoring' | 'waiting' | 'reconciliation' | 'finished' | 'finished_needs_review' | 'needs_attention' = 'scoring'
    // Mismatch is checked FIRST, before 'finished' — this is the actual
    // fix. Finishing every hole says nothing about whether reconciliation
    // is resolved; a group can be fully played AND still have an
    // unresolved mismatch, and the two are not mutually exclusive. The
    // previous ordering checked allFinished first, so a finished-but-
    // unreconciled group incorrectly showed as "all scores matched."
    if (anyMismatch) status = allFinished ? 'finished_needs_review' : 'reconciliation'
    else if (allFinished) status = 'finished'
    else if (anyWaiting) status = 'waiting'
    else if (active.length > 0 && active.every(p => p.holesPlayed === 0) && roundRes.data.status === 'active') status = 'needs_attention'

    return {
      groupId: g.id, groupName: g.name, playerCount: members.length,
      currentHole, status,
      players: members.map(p => ({ playerId: p.playerId, name: p.name, holesPlayed: p.holesPlayed, finished: p.finished, hasMismatch: p.hasMismatch, waitingForMarker: p.waitingForMarker })),
    }
  })

  // ── Alerts (current actionable state, not a history log). Each mismatch
  // now carries full identifying detail — player, marker, hole, both
  // scores, group — rather than just a per-group summary string, so the
  // organiser never has to go hunting for which score is the problem.
  interface MismatchAlert {
    severity: 'red'; kind: 'mismatch'
    playerName: string; markerName: string; groupName: string; groupId: string | null
    hole: number; playerScore: string; markerScore: string; at: string
  }
  interface SimpleAlert { severity: 'red' | 'gold' | 'green' | 'grey'; kind: 'group'; text: string }
  const mismatchAlerts: MismatchAlert[] = []
  for (const p of players) {
    for (const m of p.mismatchDetails) {
      mismatchAlerts.push({
        severity: 'red', kind: 'mismatch',
        playerName: p.name,
        markerName: markerNameByPlayerId.get(p.playerId) ?? 'Marker',
        groupName: p.groupId ? (groupNameById.get(p.groupId) ?? 'Unassigned') : 'Unassigned',
        groupId: p.groupId,
        hole: m.hn, playerScore: m.playerScore, markerScore: m.markerScore, at: m.at,
      })
    }
  }
  mismatchAlerts.sort((a, b) => b.at.localeCompare(a.at))

  const alerts: SimpleAlert[] = []
  for (const g of groups) {
    if (g.status === 'needs_attention') alerts.push({ severity: 'red', kind: 'group', text: `${g.groupName}: no scores entered yet` })
    if (g.status === 'waiting') alerts.push({ severity: 'gold', kind: 'group', text: `${g.groupName}: waiting on marker entries` })
    if (g.status === 'finished_needs_review') alerts.push({ severity: 'red', kind: 'group', text: `${g.groupName}: finished — review required` })
    if (g.status === 'finished') alerts.push({ severity: 'green', kind: 'group', text: `${g.groupName}: finished, all scores matched` })
  }
  if (alerts.length === 0 && mismatchAlerts.length === 0) alerts.push({ severity: 'green', kind: 'group', text: 'No issues — round running smoothly' })

  // ── Live stats — real, from actual gross_score vs par ───────────────────
  let birdies = 0, eagles = 0, pars = 0, bogeys = 0, holeInOnes = 0, totalPts = 0
  const holeAverages = new Map<number, { sum: number; count: number }>()
  for (const sc of scorecards) {
    for (const e of sc.score_entries ?? []) {
      if (e.capture_role !== 'self' || e.is_no_return || e.gross_score === null) continue
      const hn = holeNumberById.get(e.hole_id)
      const hole = hn !== undefined ? holeByNumber.get(hn) : undefined
      if (!hole) continue
      if (e.gross_score === 1) {
        holeInOnes++
      } else {
        const diff = e.gross_score - hole.par
        if (diff <= -2) eagles++
        else if (diff === -1) birdies++
        else if (diff === 0) pars++
        else if (diff === 1) bogeys++
      }
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

  // ── The Story — milestones only, and now (per explicit feedback)
  // genuinely FAIR ones. The previous version compared raw cumulative
  // points across players regardless of how many holes each had played —
  // a player who happened to enter scores faster could show as "leading"
  // purely from entry-timing, not real performance. Fixed by comparing
  // players ONLY at recognized checkpoints (every 3rd hole, plus the
  // final hole), and only among players who have reached that exact
  // checkpoint — so every comparison is genuinely like-for-like (same
  // holes played), not a database-insert-order artifact.
  interface HoleEntry { playerId: string; name: string; hn: number; gross: number | null; pts: number; at: string }
  const holeEntries: HoleEntry[] = []
  for (const sc of scorecards) {
    for (const e of sc.score_entries ?? []) {
      if (e.capture_role !== 'self') continue
      const hn = holeNumberById.get(e.hole_id)
      if (hn === undefined) continue
      holeEntries.push({ playerId: sc.player_id, name: sc.profiles?.full_name ?? 'Player', hn, gross: e.gross_score, pts: e.stableford_pts ?? 0, at: e.entered_at })
    }
  }

  const story: { icon: string; text: string; at: string }[] = []

  // Hole-in-one — an individual real event, unaffected by the
  // cross-player fairness issue above. Detected purely on gross_score,
  // never on Stableford points or any derived value, per the explicit
  // verification request.
  for (const e of holeEntries) {
    if (e.gross === 1) story.push({ icon: '⛳', text: `${e.name} records a hole-in-one on Hole ${e.hn}!`, at: e.at })
  }

  // Per-player cumulative points BY HOLE NUMBER (not entry/submission
  // order) — cumByHoleCount.get(playerId)[n] = total points from holes
  // 1..n for that player, so "through 9 holes" always means the same
  // thing regardless of what order they happened to confirm scores in.
  const byPlayerHoles = new Map<string, HoleEntry[]>()
  for (const e of holeEntries) {
    if (!byPlayerHoles.has(e.playerId)) byPlayerHoles.set(e.playerId, [])
    byPlayerHoles.get(e.playerId)!.push(e)
  }
  const cumByHoleCount = new Map<string, number[]>()
  const atByHoleCount = new Map<string, string[]>()
  for (const [pid, arr] of byPlayerHoles) {
    arr.sort((a, b) => a.hn - b.hn)
    const cum: number[] = [0]
    const at: string[] = ['']
    let running = 0
    for (const e of arr) { running += e.pts; cum.push(running); at.push(e.at) }
    cumByHoleCount.set(pid, cum)
    atByHoleCount.set(pid, at)
  }

  // Recognized checkpoints: every 3rd hole, always including the final
  // hole of the round.
  const checkpoints: number[] = []
  for (let c = 3; c < totalHoles; c += 3) checkpoints.push(c)
  checkpoints.push(totalHoles)

  interface CheckpointResult { checkpoint: number; leaderId: string | null; leaderName: string; at: string; ranks: Map<string, number> }
  const checkpointResults: CheckpointResult[] = []
  for (const c of checkpoints) {
    const eligible = players.filter(p => p.holesPlayed >= c)
    if (eligible.length < 2) continue // need at least 2 comparable players for "leading" to mean anything
    const withScores = eligible.map(p => ({
      playerId: p.playerId, name: p.name,
      pts: cumByHoleCount.get(p.playerId)?.[c] ?? 0,
      at: atByHoleCount.get(p.playerId)?.[c] ?? '',
    })).sort((a, b) => b.pts - a.pts)
    const ranks = new Map<string, number>()
    withScores.forEach((w, i) => ranks.set(w.playerId, i + 1))
    const latestAt = withScores.reduce((max, w) => (w.at > max ? w.at : max), '')
    checkpointResults.push({ checkpoint: c, leaderId: withScores[0]?.playerId ?? null, leaderName: withScores[0]?.name ?? '', at: latestAt, ranks })
  }

  let checkpointLeader: string | null = null
  for (const cp of checkpointResults) {
    if (cp.leaderId && cp.leaderId !== checkpointLeader) {
      story.push({
        icon: checkpointLeader === null ? '🟢' : '🥇',
        text: checkpointLeader === null
          ? `Through ${cp.checkpoint} holes — ${cp.leaderName} leads`
          : `${cp.leaderName} moves into first place through ${cp.checkpoint} holes`,
        at: cp.at,
      })
      checkpointLeader = cp.leaderId
    }
  }

  // Worst-vs-final checkpoint rank, for Biggest Leaderboard Climb — same
  // fairness fix applies here: comparing a player's rank at one checkpoint
  // against their rank at another checkpoint is fair (same holes played
  // at each), unlike comparing raw chronological-replay ranks.
  const worstCheckpointRank = new Map<string, number>()
  const finalCheckpointRank = new Map<string, number>()
  for (const cp of checkpointResults) {
    for (const [pid, rank] of cp.ranks) {
      worstCheckpointRank.set(pid, Math.max(worstCheckpointRank.get(pid) ?? 0, rank))
      finalCheckpointRank.set(pid, rank) // ends up as the last checkpoint each player appeared in
    }
  }

  // Mismatch-detected milestones — reuses mismatchDetails already computed
  // above (no second pass over score_entries).
  for (const p of players) {
    for (const m of p.mismatchDetails) {
      story.push({ icon: '⚠️', text: `Score review required — Hole ${m.hn}, ${p.name}`, at: m.at })
    }
  }

  // Final group finished.
  for (const g of groups) {
    if ((g.status === 'finished' || g.status === 'finished_needs_review') && g.players.length > 0) {
      const lastEntry = holeEntries.filter(t => g.players.some(p => p.name === t.name)).sort((a, b) => b.at.localeCompare(a.at))[0]
      if (lastEntry) story.push({ icon: '🏁', text: `${g.groupName} finished`, at: lastEntry.at })
    }
  }

  if (roundRes.data.status === 'completed') {
    const sortedEntries = [...holeEntries].sort((a, b) => a.at.localeCompare(b.at))
    const lastAt = sortedEntries.length > 0 ? sortedEntries[sortedEntries.length - 1].at : new Date().toISOString()
    story.push({ icon: '🏆', text: 'Round completed', at: lastAt })
  }

  story.sort((a, b) => b.at.localeCompare(a.at))

  // ── Today's Highlights — post-round only, real numbers only. No
  // Moments/Longest Drive/Nearest Pin references — that data doesn't
  // exist yet, and fabricating placeholder numbers here would be exactly
  // the "do not fabricate" violation the brief explicitly warns against.
  const highlights: string[] = []
  if (roundRes.data.status === 'completed' && ranked.length > 0) {
    const winner = ranked[0]
    const runnerUp = ranked[1]
    if (runnerUp) highlights.push(`🏆 ${winner.name} wins by ${winner.totalPts - runnerUp.totalPts} Stableford point${winner.totalPts - runnerUp.totalPts === 1 ? '' : 's'}`)
    else if (winner) highlights.push(`🏆 ${winner.name} wins`)
    if (birdies > 0) highlights.push(`⛳ ${birdies} birdie${birdies === 1 ? '' : 's'} recorded today`)
    if (eagles > 0) highlights.push(`🦅 ${eagles} eagle${eagles === 1 ? '' : 's'} recorded today`)
    if (holeInOnes > 0) highlights.push(`⛳ ${holeInOnes} hole-in-one${holeInOnes === 1 ? '' : 's'} recorded today`)
    // Biggest Leaderboard Climb (renamed from "Biggest Comeback") — now
    // uses worst-vs-final CHECKPOINT rank, not raw chronological-replay
    // rank, so it's comparing each player against themselves at genuinely
    // equivalent stages of play (same holes played at each checkpoint),
    // not an artifact of entry timing.
    let biggestClimb: { name: string; climb: number } | null = null
    for (const p of ranked) {
      const worst = worstCheckpointRank.get(p.playerId)
      const final = finalCheckpointRank.get(p.playerId)
      if (worst === undefined || final === undefined) continue
      const climb = worst - final
      if (climb >= 3 && (!biggestClimb || climb > biggestClimb.climb)) biggestClimb = { name: p.name, climb }
    }
    if (biggestClimb) { const bc: { name: string; climb: number } = biggestClimb; highlights.push(`🔥 Biggest Leaderboard Climb: ${bc.name} climbed ${bc.climb} place${bc.climb === 1 ? '' : 's'}`) }
  }

  const finishedCount = players.filter(p => p.finished).length
  const scoringNow = players.filter(p => p.holesPlayed > 0 && !p.finished).length
  const awaitingReconciliation = players.filter(p => p.hasMismatch).length
  const totalHolesExpected = players.length * totalHoles
  const totalHolesPlayed = players.reduce((s, p) => s + p.holesPlayed, 0)
  const completionPct = totalHolesExpected > 0 ? Math.round((totalHolesPlayed / totalHolesExpected) * 100) : 0

  let health: { level: 'green' | 'gold' | 'red'; text: string; topMismatch?: MismatchAlert }
  if (mismatchAlerts.length === 1) {
    health = { level: 'red', text: '1 score requires review', topMismatch: mismatchAlerts[0] }
  } else if (mismatchAlerts.length > 1) {
    health = { level: 'red', text: `${mismatchAlerts.length} scores require review` }
  } else if (groups.some(g => g.status === 'waiting' || g.status === 'needs_attention')) {
    const n = groups.filter(g => g.status === 'waiting' || g.status === 'needs_attention').length
    health = { level: 'gold', text: `${n} group${n === 1 ? '' : 's'} need attention` }
  } else health = { level: 'green', text: 'Everything on track' }

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
    mismatchAlerts,
    leaderboardSnapshot,
    story: story.slice(0, 10),
    highlights,
    stats: {
      birdies, eagles, pars, bogeys, holeInOnes,
      avgStableford: (() => {
        const activePlayers = players.filter(p => p.holesPlayed > 0).length
        return activePlayers > 0 ? Math.round((totalPts / activePlayers) * 10) / 10 : 0
      })(),
      bestHole, hardestHole,
    },
  })
}
