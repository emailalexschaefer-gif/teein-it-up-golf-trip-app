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
  is_no_return: boolean; capture_role: string; entered_at: string; admin_overridden: boolean
}
interface ScorecardRow {
  id: string; player_id: string; status: string; submitted_at: string | null
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
    .select('id, name, holes, status, scoring_format, score_capture_mode, course_name')
    .eq('id', roundId).eq('trip_id', tripId).maybeSingle()
  if (!roundRes.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })
  const totalHoles: number = roundRes.data.holes ?? 18
  const isMarkerMode = roundRes.data.score_capture_mode === 'self_and_marker'

  const holesRes = await admin.from('holes').select('id, hole_number, par').eq('round_id', roundId)
  const holeByNumber = new Map<number, HoleRow>((holesRes.data ?? []).map((h: HoleRow) => [h.hole_number, h]))

  const groupsRes = await admin.from('trip_groups').select('id, name, sort_order').eq('trip_id', tripId).order('sort_order')

  const scRes = await admin.from('scorecards')
    .select(`
      id, player_id, status, submitted_at, scoring_method,
      profiles:player_id ( full_name ),
      score_entries ( hole_id, gross_score, stableford_pts, is_no_return, capture_role, entered_at, admin_overridden )
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
    confirmationState: 'scoring' | 'review_required' | 'ready_to_confirm' | 'confirmed'
    submittedAt: string | null
    // Offline Player Support, item 10 — a paper player's digital
    // holesPlayed/finished/waitingForMarker are all meaningless (they
    // never enter digital scores at all), so isPaper lets the group-
    // level status computation below exclude them from digital-
    // progress logic entirely, rather than a paper player with 0 holes
    // played incorrectly reading as "hasn't started" or blocking
    // allFinished from a digital standpoint. paperCardOutstanding is
    // the actual, correct signal for them instead — true until an
    // official score exists (capture_role='self' entries present),
    // exactly the same "does an official score exist yet" check used
    // everywhere else in this app, not a new concept.
    isPaper: boolean; paperCardOutstanding: boolean
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
        // Organiser adjudication fix — an admin_overridden self entry
        // (Package 3 P0 corrective) is the organiser's own authoritative
        // ruling, not another input into player/marker reconciliation.
        // Previously this comparison only ever looked at raw
        // self.gross_score vs marker.gross_score, so an organiser
        // correction of Alex's own entry (5 -> 3) still disagreed with
        // TEST's untouched marker entry (4) and kept surfacing as an
        // active "needs review" mismatch even after the organiser had
        // explicitly resolved it — exactly the reported bug. The
        // marker's historical entry is deliberately left completely
        // untouched here (still 4, exactly as TEST submitted it) — this
        // only changes whether it's treated as an ACTIVE dispute, never
        // rewrites what TEST actually recorded.
        const differs = !self.admin_overridden && (
          self.is_no_return !== marker.is_no_return
          || (!self.is_no_return && self.gross_score !== marker.gross_score)
        )
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
          comparisonResult: self.admin_overridden ? 'resolved_by_organiser' : (differs ? 'mismatch' : 'matched'),
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
    const isPaper = sc.scoring_method === 'paper'
    const paperCardOutstanding = isPaper && holesPlayed < totalHoles
    // Per-player confirmation state for My HQ's state column — derived
    // from signals already computed above (finished/hasMismatch/
    // waitingForMarker) plus the scorecard's own status, not a second
    // parallel computation of the same thing.
    const confirmationState: 'scoring' | 'review_required' | 'ready_to_confirm' | 'confirmed' =
      sc.status === 'completed' ? 'confirmed'
      : isPaper ? (paperCardOutstanding ? 'scoring' : 'ready_to_confirm')
      : hasMismatch ? 'review_required'
      : (holesPlayed >= totalHoles && !waitingForMarker) ? 'ready_to_confirm'
      : 'scoring'
    return {
      playerId: sc.player_id,
      name: sc.profiles?.full_name ?? 'Player',
      holesPlayed,
      // Offline Player Support, item 10 — a paper player whose card has
      // already been entered (paperCardOutstanding false) is correctly
      // "finished" for digital-progress purposes even though they never
      // played a single digital hole; one still outstanding is
      // correctly NOT finished, matching "the round should not fully
      // close until required paper cards are entered."
      finished: isPaper ? !paperCardOutstanding : holesPlayed >= totalHoles,
      hasMismatch,
      waitingForMarker,
      isPaper,
      paperCardOutstanding,
      mismatchDetails,
      groupId: groupIdByProfile.get(sc.player_id) ?? null,
      totalPts,
      confirmationState,
      submittedAt: sc.submitted_at ?? null,
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
    // Offline Player Support, item 10 — currentHole (and the
    // needs_attention check just below) are both about DIGITAL scoring
    // progress specifically. digitallyActive excludes paper players —
    // their holesPlayed is always 0 regardless of how far the round has
    // actually progressed for everyone else, so including them here
    // would either stall currentHole at 1 forever or, worse, incorrectly
    // trigger "needs_attention" (looks like nobody has started) for a
    // group where every digital player has already finished and the
    // only remaining thing is an outstanding paper card — a completely
    // different, correctly-labelled situation (paperCardOutstanding
    // below), not a "hasn't started" one.
    const digitallyActive = active.filter(p => !p.isPaper)
    const anyPaperOutstanding = members.some(p => p.paperCardOutstanding)
    const currentHole = digitallyActive.length > 0 ? Math.min(...digitallyActive.map(p => p.holesPlayed)) + 1 : totalHoles
    const anyMismatch = members.some(p => p.hasMismatch)
    const anyWaiting = members.some(p => p.waitingForMarker)
    const allFinished = members.length > 0 && members.every(p => p.finished)

    let status: 'scoring' | 'waiting' | 'reconciliation' | 'finished' | 'finished_needs_review' | 'needs_attention' | 'paper_outstanding' = 'scoring'
    // Mismatch is checked FIRST, before 'finished' — this is the actual
    // fix. Finishing every hole says nothing about whether reconciliation
    // is resolved; a group can be fully played AND still have an
    // unresolved mismatch, and the two are not mutually exclusive. The
    // previous ordering checked allFinished first, so a finished-but-
    // unreconciled group incorrectly showed as "all scores matched."
    if (anyMismatch) status = allFinished ? 'finished_needs_review' : 'reconciliation'
    else if (allFinished) status = 'finished'
    // Offline Player Support — every digital player is finished and
    // reconciled, but a paper card is still outstanding. Its own
    // distinct status, not folded into 'waiting' (which means "waiting
    // for a digital marker") or 'needs_attention' (which means "nobody
    // has started") — neither is true here.
    else if (anyPaperOutstanding && digitallyActive.length === 0) status = 'paper_outstanding'
    else if (anyWaiting) status = 'waiting'
    else if (digitallyActive.length > 0 && digitallyActive.every(p => p.holesPlayed === 0) && roundRes.data.status === 'active') status = 'needs_attention'

    return {
      groupId: g.id, groupName: g.name, playerCount: members.length,
      currentHole, status,
      // Field-Test Fix Package, item 1 — isPaper/paperCardOutstanding
      // now exposed here (previously computed on PlayerState but never
      // included in this specific projection), so the client can show
      // the explicit "✏️ Paper Card Outstanding / Enter Paper
      // Scorecard →" per-player line the brief's own example shows,
      // not just rely on the group-level badge.
      players: members.map(p => ({ playerId: p.playerId, name: p.name, holesPlayed: p.holesPlayed, finished: p.finished, hasMismatch: p.hasMismatch, waitingForMarker: p.waitingForMarker, confirmationState: p.confirmationState, submittedAt: p.submittedAt, isPaper: p.isPaper, paperCardOutstanding: p.paperCardOutstanding })),
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

  const story: { icon: string; text: string; at: string; imageUrl?: string }[] = []

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

  // Same per-hole closure signal as the Side Games route: reuses the
  // scorecards/score_entries data already fetched above (scRes) rather
  // than a new query — every active scorecard needs a self-captured
  // entry for this specific hole_number before the competition on it can
  // be considered genuinely finished. A player who hasn't started (no
  // entries at all) or any scorecard missing just this one hole both
  // correctly keep this false.
  function isHoleComplete(holeNumber: number | null): boolean {
    if (holeNumber === null) return false
    const holeRow = holeByNumber.get(holeNumber)
    if (!holeRow) return false
    const activeCards = scRes.data ?? []
    if (activeCards.length === 0) return false
    return activeCards.every((sc: { score_entries: { hole_id: string; capture_role: string }[] }) =>
      (sc.score_entries ?? []).some(e => e.hole_id === holeRow.id && e.capture_role === 'self')
    )
  }

  // ── Side Competition events (Sprint 9 Item 3) ────────────────────────────
  // Entirely computed here, at read time, from side_comp_lead_changes (the
  // append-only log — never replayed/derived from mutable side_comp_entries)
  // and the same per-hole closure signal the Side Games route uses. This is
  // what makes it idempotent by construction: recomputing this on every poll
  // produces the exact same list every time, because nothing is ever
  // inserted anywhere as a side effect of a GET — there is no separate
  // "story_events" table to accidentally duplicate rows in.
  try {
    const compsRes = await admin.from('side_comps').select('id, comp_type, hole_number').eq('round_id', roundId).eq('enabled', true)
    const comps = compsRes.data ?? []
    if (comps.length > 0) {
      const compIds = comps.map((c: { id: string }) => c.id)
      const changesRes = await admin
        .from('side_comp_lead_changes')
        .select('id, side_comp_id, player_id, result_value, sequence_number, moment_id, created_at, profiles:player_id(full_name)')
        .in('side_comp_id', compIds)
        .order('sequence_number', { ascending: true })
      const changes = (changesRes.data ?? []) as { id: string; side_comp_id: string; player_id: string; result_value: number; sequence_number: number; moment_id: string | null; created_at: string; profiles: { full_name: string } | null }[]

      // Current verification_status for every player/comp pair that
      // appears in the leadership log — needed for the winner
      // determination below. Without this, "the last lead-change row"
      // could point at a player whose entry has since flipped back to
      // 'pending' via resubmission (submit_side_comp_value_entry/
      // submit_longest_drive_entry both unconditionally reset status to
      // 'pending' on any resubmission, even of a previously-verified
      // claim) — Stage 4's own review, same bug class as the one fixed
      // in the Side Games route's Longest Drive log-walk.
      const entriesRes = compIds.length > 0
        ? await admin.from('side_comp_entries').select('side_comp_id, player_id, verification_status, result_value').in('side_comp_id', compIds)
        : { data: [] as { side_comp_id: string; player_id: string; verification_status: string; result_value: number | null }[] }
      const verifiedNow = new Set(
        ((entriesRes.data ?? []) as { side_comp_id: string; player_id: string; verification_status: string; result_value: number | null }[])
          .filter(e => e.verification_status === 'verified')
          .map(e => `${e.side_comp_id}:${e.player_id}`)
      )
      // Current (possibly re-corrected) result_value per (comp, player) —
      // used only for the final winner announcement below, never for the
      // mid-battle "takes the lead" lines, which stay historically
      // accurate to the value at the moment each hand-off actually
      // happened (side_comp_lead_changes.result_value, its own permanent
      // record). The winner line is the one place a later correction
      // (without a further leadership hand-off) must be reflected — per
      // explicit instruction, official displays always use the current
      // verified value.
      const currentValueByPlayer = new Map(
        ((entriesRes.data ?? []) as { side_comp_id: string; player_id: string; result_value: number | null }[])
          .map(e => [`${e.side_comp_id}:${e.player_id}`, e.result_value])
      )

      const COMP_LABEL: Record<string, string> = { nearest_pin: 'NTP', longest_drive: 'Longest Drive', pros_approach: "Pro's Approach" }
      const changesByComp = new Map<string, typeof changes>()
      for (const c of changes) {
        if (!changesByComp.has(c.side_comp_id)) changesByComp.set(c.side_comp_id, [])
        changesByComp.get(c.side_comp_id)!.push(c)
      }

      for (const comp of comps) {
        // Powerplay has no leadership/entries concept at all — no
        // side_comp_entries are ever written for it (see migration 037's
        // own comment on that table), so changesByComp naturally has no
        // rows for a powerplay comp.id and this loop contributes nothing
        // for it, which is correct: Powerplay's story presence (if any)
        // belongs to the future automatic Golf Moments engine reading
        // score_entries directly, not this leadership-history mechanism.
        const compChanges = changesByComp.get(comp.id) ?? []
        const label = COMP_LABEL[comp.comp_type] ?? 'Side Competition'
        // Every competition's story text names its hole explicitly — not
        // just for Longest Drive's benefit, but because any repeated
        // competition type (two NTPs, per the corrected multi-instance
        // architecture) would otherwise produce genuinely ambiguous
        // wording like "Darren takes the NTP lead" with no way to tell
        // which of two NTP competitions that refers to.
        const holeSuffix = comp.hole_number ? ` on Hole ${comp.hole_number}` : ''

        for (const change of compChanges) {
          const text = comp.comp_type === 'longest_drive'
            ? `${change.profiles?.full_name ?? 'A player'} takes the ${label} lead${holeSuffix}`
            : `${change.profiles?.full_name ?? 'A player'} takes the ${label} lead — ${change.result_value}m${holeSuffix}`
          let imageUrl: string | undefined
          if (change.moment_id) {
            const momentRes = await admin.from('moments').select('image_path').eq('id', change.moment_id).maybeSingle()
            if (momentRes.data?.image_path) {
              const signed = await admin.storage.from('event-moments').createSignedUrl(momentRes.data.image_path, 3600)
              imageUrl = signed.data?.signedUrl ?? undefined
            }
          }
          story.push({ icon: comp.comp_type === 'longest_drive' ? '💥' : '🎯', text, at: change.created_at, imageUrl })
        }

        // Hotly Contested — fires once the 5th change happens (not once
        // per subsequent change), by construction: this reads sequence_
        // number === 5 specifically, not "length >= 5", so it can never
        // re-fire or duplicate on every later change once the threshold
        // is already passed.
        const fifthChange = compChanges.find(c => c.sequence_number === 5)
        if (fifthChange) {
          story.push({ icon: '🔥', text: `${label} lead changes hands for the fifth time${holeSuffix} — HOTLY CONTESTED`, at: fifthChange.created_at })
        }

        // Winner — only once the competition's own hole is genuinely
        // complete (same per-hole closure signal as the Side Games route:
        // every active scorecard has a self-captured entry for that hole),
        // never merely because the current group finished. The explicit
        // caution here: a player who hasn't started, or any active
        // scorecard missing a self-entry for this hole, must keep this
        // false — isHoleComplete already returns false in exactly that
        // case (a missing entry fails the `.every(...)` check), so there's
        // no separate "is everyone genuinely done" condition to get wrong
        // here beyond what that function already guarantees.
        //
        // Walks the log from most recent, same as the Side Games route's
        // Longest Drive derivation — not just "the last row" — verified
        // against verifiedNow so a player whose entry has since flipped
        // back to pending (via resubmission) is correctly skipped rather
        // than incorrectly declared the winner.
        if (compChanges.length > 0 && isHoleComplete(comp.hole_number)) {
          let winningChange: typeof compChanges[number] | undefined
          for (let i = compChanges.length - 1; i >= 0; i--) {
            if (verifiedNow.has(`${comp.id}:${compChanges[i].player_id}`)) { winningChange = compChanges[i]; break }
          }
          if (winningChange) {
            const currentValue = currentValueByPlayer.get(`${comp.id}:${winningChange.player_id}`) ?? winningChange.result_value
            const winText = comp.comp_type === 'longest_drive'
              ? `🏆 ${winningChange.profiles?.full_name ?? 'A player'} wins ${label}${holeSuffix}`
              : `🏆 ${winningChange.profiles?.full_name ?? 'A player'} wins ${label}${holeSuffix} — ${currentValue}m`
            story.push({ icon: '🏆', text: winText, at: winningChange.created_at })
          }
        }
      }
    }
  } catch (compStoryErr) {
    // Same reasoning as the cumulative-standings try/catch elsewhere in
    // this codebase: Side Competition Story events are additive — if this
    // fails for any reason, the core Story (golf milestones) must still
    // return correctly.
    console.error('[tournament] side-competition story events failed (core story still returned)', {
      tripId, roundId, error: compStoryErr instanceof Error ? compStoryErr.message : String(compStoryErr),
    })
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
    courseName: roundRes.data.course_name ?? null,
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
