/**
 * GET /api/trips/[tripId]/rounds/[roundId]/my-round
 *
 * Personal round dashboard data for the calling player — status/next-
 * action, personal score snapshot, personal alerts, personal story, and
 * group info. NOT organiser-gated: any trip member can call this for
 * their own round, since it only ever returns the caller's own data.
 *
 * Deliberately reuses the same computation approach already established
 * in the tournament and leaderboard routes rather than inventing a
 * second Stableford total or ranking implementation:
 * - capture_role='self' as the authoritative source for a player's own
 *   total (same convention as leaderboard/tournament).
 * - the same gross-vs-par diff logic for birdies/eagles (tournament route).
 * - the same checkpoint-based ranking approach (tournament route's Story
 *   section) for "current position" and personal rank-change milestones,
 *   scoped down to just this player's own rank history rather than
 *   everyone's.
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
interface HoleRow { id: string; hole_number: number; par: number }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const membership = await admin.from('trip_members').select('group_id').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!membership.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

  const roundRes = await admin.from('rounds').select('id, name, holes, status, scoring_format, score_capture_mode').eq('id', roundId).eq('trip_id', tripId).maybeSingle()
  if (!roundRes.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })
  const totalHoles: number = roundRes.data.holes ?? 18
  const isMarkerMode = roundRes.data.score_capture_mode === 'self_and_marker'

  const holesRes = await admin.from('holes').select('id, hole_number, par').eq('round_id', roundId)
  const holeByNumber = new Map<number, HoleRow>((holesRes.data ?? []).map((h: HoleRow) => [h.hole_number, h]))
  const holeNumberById = new Map<string, number>((holesRes.data ?? []).map((h: HoleRow) => [h.id, h.hole_number]))

  // ── All scorecards for this round (needed for ranking — same approach
  // as the leaderboard route) ─────────────────────────────────────────────
  const scRes = await admin.from('scorecards')
    .select(`id, player_id, playing_handicap, status, profiles:player_id ( full_name ), score_entries ( hole_id, gross_score, stableford_pts, is_no_return, capture_role, entered_at, admin_overridden )`)
    .eq('round_id', roundId)
    .neq('status', 'withdrawn')

  if (scRes.error) {
    console.error('[my-round]', scRes.error)
    return NextResponse.json({ error: 'Could not load your round.' }, { status: 500 })
  }

  interface ScorecardRow { id: string; player_id: string; playing_handicap: number; profiles: { full_name: string } | null; score_entries: ScoreEntryRow[] }
  const scorecards = (scRes.data ?? []) as ScorecardRow[]
  const myCard = scorecards.find(sc => sc.player_id === user.id)

  if (!myCard) {
    return NextResponse.json({
      hasScorecard: false, roundName: roundRes.data.name, roundStatus: roundRes.data.status,
    })
  }

  // ── My personal entries, self vs marker ─────────────────────────────────
  const mySelfByHole = new Map<number, ScoreEntryRow>()
  const myMarkerByHole = new Map<number, ScoreEntryRow>()
  for (const e of myCard.score_entries ?? []) {
    const hn = holeNumberById.get(e.hole_id)
    if (hn === undefined) continue
    if (e.capture_role === 'self') mySelfByHole.set(hn, e)
    else if (e.capture_role === 'marker') myMarkerByHole.set(hn, e)
  }
  const holesPlayed = mySelfByHole.size
  const finished = holesPlayed >= totalHoles

  // Personal mismatches — same diff logic as the tournament route.
  //
  // Package 3 final propagation fix — this route previously had its
  // own, completely independent copy of the differs check with no
  // admin_overridden awareness at all (not selected in the query, not
  // checked in the diff). This is the actual source of "My Golf still
  // shows red review warnings" — the tournament route's own version of
  // this exact logic was already fixed in an earlier pass, but this
  // one, feeding My Golf specifically, was never touched and had
  // silently drifted out of sync. Status precedence
  // (resolved_by_organiser before unresolved mismatch) is enforced the
  // same way as the tournament route: admin_overridden holes are
  // excluded from mismatches entirely, then separately collected into
  // organiserOverrides so the amber indicator has something to render
  // from — never both for the same hole.
  const mismatches: { hole: number; playerScore: string; markerScore: string }[] = []
  const organiserOverrides: { hole: number; officialScore: string }[] = []
  let waitingForMarker = false
  if (isMarkerMode) {
    for (const [hn, self] of mySelfByHole) {
      const marker = myMarkerByHole.get(hn)
      if (!marker) { waitingForMarker = true; continue }
      if (self.admin_overridden) {
        organiserOverrides.push({ hole: hn, officialScore: self.is_no_return ? 'No return' : String(self.gross_score) })
        continue
      }
      const differs = self.is_no_return !== marker.is_no_return || (!self.is_no_return && self.gross_score !== marker.gross_score)
      if (differs) mismatches.push({ hole: hn, playerScore: self.is_no_return ? 'No return' : String(self.gross_score), markerScore: marker.is_no_return ? 'No return' : String(marker.gross_score) })
    }
  }

  // Personal stats — birdies/eagles/pars/bogeys, best hole, F9/B9 totals.
  let birdies = 0, eagles = 0, holeInOnes = 0, front9Pts = 0, back9Pts = 0
  let bestHole: { number: number; pts: number } | null = null
  for (const [hn, e] of mySelfByHole) {
    const hole = holeByNumber.get(hn)
    if (hole && !e.is_no_return && e.gross_score !== null) {
      const diff = e.gross_score - hole.par
      if (e.gross_score === 1) holeInOnes++
      else if (diff <= -2) eagles++
      else if (diff === -1) birdies++
    }
    if (hn <= 9) front9Pts += e.stableford_pts ?? 0
    else back9Pts += e.stableford_pts ?? 0
    if (!bestHole || (e.stableford_pts ?? 0) > bestHole.pts) bestHole = { number: hn, pts: e.stableford_pts ?? 0 }
  }
  const totalPts = front9Pts + back9Pts

  // ── Ranking — identical approach to the leaderboard route (capture_
  // role='self' sum, ties by fewer holes played), scoped to return only
  // this player's own position, not the whole board. ─────────────────────
  const ranked = scorecards.map(sc => {
    const selfPts = (sc.score_entries ?? []).filter(e => e.capture_role === 'self').reduce((s, e) => s + (e.stableford_pts ?? 0), 0)
    const selfHoles = (sc.score_entries ?? []).filter(e => e.capture_role === 'self').length
    return { playerId: sc.player_id, totalPts: selfPts, holesPlayed: selfHoles }
  }).sort((a, b) => b.totalPts - a.totalPts || b.holesPlayed - a.holesPlayed)
  const myPosition = ranked.findIndex(r => r.playerId === user.id) + 1

  // ── Group info ───────────────────────────────────────────────────────────
  let groupName: string | null = null
  let groupMembers: string[] = []
  if (membership.data.group_id) {
    const groupRes = await admin.from('trip_groups').select('name').eq('id', membership.data.group_id).maybeSingle()
    groupName = groupRes.data?.name ?? null
    const groupMemberIds = await admin.from('trip_members').select('profile_id').eq('trip_id', tripId).eq('group_id', membership.data.group_id)
    const memberProfiles = await admin.from('profiles').select('id, full_name').in('id', (groupMemberIds.data ?? []).map((m: { profile_id: string }) => m.profile_id))
    groupMembers = (memberProfiles.data ?? []).map((p: { full_name: string }) => p.full_name)
  }

  // My marker's name, if applicable.
  let markerName: string | null = null
  if (isMarkerMode) {
    const markerRes = await admin.from('round_markers').select('marker_player_id').eq('round_id', roundId).eq('player_id', user.id).maybeSingle()
    if (markerRes.data) {
      const markerProfile = await admin.from('profiles').select('full_name').eq('id', markerRes.data.marker_player_id).maybeSingle()
      markerName = markerProfile.data?.full_name ?? null
    }
  }

  // ── Status / next action ────────────────────────────────────────────────
  let status: 'waiting_for_round' | 'active' | 'review_required' | 'complete' | 'published'
  if (roundRes.data.status === 'upcoming') status = 'waiting_for_round'
  else if (mismatches.length > 0) status = 'review_required'
  else if (finished) status = roundRes.data.status === 'completed' ? 'published' : 'complete'
  else status = 'active'

  // ── Personal story — only this player's own milestones, not the full
  // event Story. Hole-in-ones and mismatches are real, per-player events;
  // "moved into Nth" would need the same checkpoint-replay the tournament
  // route already builds for the full event — reused at the same
  // granularity (every 3rd hole + final) but reporting only how THIS
  // player's own position changed, not everyone's. ───────────────────────
  const myStory: { icon: string; text: string }[] = []
  for (const [hn, e] of mySelfByHole) {
    if (e.gross_score === 1) myStory.push({ icon: '⛳', text: `Hole-in-one on Hole ${hn}!` })
  }
  if (holesPlayed >= 9 && front9Pts > 0) myStory.push({ icon: '⛳', text: `Front 9 complete — ${front9Pts} pts` })
  for (const m of mismatches) myStory.push({ icon: '⚠️', text: `Hole ${m.hole} needs review` })
  // Package 3 final propagation fix — subtle amber My Golf indicator
  // for an organiser-adjudicated hole, per the explicit "may show a
  // subtle amber ⚙️ Organiser Override — Hole 2, but it must not tell
  // the player they still need to fix anything" instruction. Uses ⚙️,
  // not ⚠️, and says nothing about the player needing to act.
  for (const o of organiserOverrides) myStory.push({ icon: '⚙️', text: `Organiser Override — Hole ${o.hole}` })

  const checkpoints: number[] = []
  for (let c = 3; c < totalHoles; c += 3) checkpoints.push(c)
  checkpoints.push(totalHoles)
  let prevMyRank: number | null = null
  for (const c of checkpoints) {
    const eligible = scorecards.filter(sc => (sc.score_entries ?? []).filter(e => e.capture_role === 'self').length >= c)
    if (eligible.length < 2) continue
    const atCheckpoint = eligible.map(sc => ({
      playerId: sc.player_id,
      pts: (sc.score_entries ?? []).filter(e => e.capture_role === 'self' && (holeNumberById.get(e.hole_id) ?? 999) <= c).reduce((s, e) => s + (e.stableford_pts ?? 0), 0),
    })).sort((a, b) => b.pts - a.pts)
    const myRank = atCheckpoint.findIndex(r => r.playerId === user.id) + 1
    if (myRank > 0 && prevMyRank !== null && myRank !== prevMyRank) {
      myStory.push({ icon: myRank < prevMyRank ? '🔼' : '🔽', text: `Moved into ${ordinal(myRank)} through ${c} holes` })
    }
    if (myRank > 0) prevMyRank = myRank
  }

  return NextResponse.json({
    hasScorecard: true,
    roundName: roundRes.data.name,
    roundStatus: roundRes.data.status,
    scoringFormat: roundRes.data.scoring_format,
    status,
    playingHandicap: myCard.playing_handicap,
    holesPlayed, totalHoles, finished,
    totalPts, front9Pts, back9Pts,
    position: myPosition, totalPlayers: ranked.length,
    birdies, eagles, holeInOnes, bestHole,
    mismatches, waitingForMarker, organiserOverrides,
    groupName, groupMembers, markerName,
    story: myStory.slice(-10).reverse(),
  })
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}
