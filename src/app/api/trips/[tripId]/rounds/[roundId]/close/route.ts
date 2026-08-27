/**
 * POST /api/trips/[tripId]/rounds/[roundId]/close
 *
 * Organiser-only. Transitions a round from 'active' to 'completed'. This is
 * the missing counterpart to start/route.ts (which does 'upcoming' →
 * 'active') — no equivalent existed anywhere in the codebase before this,
 * confirmed by search before writing it. Deliberately minimal: a guarded
 * status transition, not new scoring logic. Guards server-side (not just in
 * the UI) that the round is actually complete before allowing the close.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRoundCompletion } from '@/lib/scoring/roundCompletion'
import { detectSharedDeviceGroup } from '@/lib/scoring/sharedDeviceScoring'

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

export async function POST(_req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const memberCheck = await admin.from('trip_members').select('role')
    .eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberCheck.data || memberCheck.data.role !== 'organiser') {
    return NextResponse.json({ error: 'Only the organiser can close a round.' }, { status: 403 })
  }

  const roundRes = await admin.from('rounds').select('id, status, holes, score_capture_mode')
    .eq('id', roundId).eq('trip_id', tripId).maybeSingle()
  if (!roundRes.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })
  if (roundRes.data.status !== 'active') {
    return NextResponse.json({ error: 'Only an active round can be closed.' }, { status: 409 })
  }

  // Server-side completion guard — the exact same condition the Tournament
  // Control UI uses to decide whether to show the button, checked again
  // here so this can't be closed early via a direct API call.
  const scRes = await admin.from('scorecards')
    .select('id, player_id, status, scoring_method, group_id, score_entries ( hole_id, gross_score, is_no_return, capture_role )')
    .eq('round_id', roundId).neq('status', 'withdrawn')

  const totalHoles = roundRes.data.holes ?? 18
  const isMarkerMode = roundRes.data.score_capture_mode === 'self_and_marker'

  // Shared-Device Two-Player Fix — group members by their round-
  // specific scorecards.group_id snapshot (not mutable trip grouping)
  // and detect a genuine 1-digital+1-paper pair per group, reusing the
  // exact same detection function the shared-device scoring shell
  // itself uses — one detection rule, not a second copy of it here.
  const byGroup = new Map<string, { player_id: string; scoring_method: string }[]>()
  for (const sc of scRes.data ?? []) {
    if (!sc.group_id) continue
    const list = byGroup.get(sc.group_id) ?? []
    list.push({ player_id: sc.player_id, scoring_method: sc.scoring_method })
    byGroup.set(sc.group_id, list)
  }
  const sharedDevicePlayerIds = new Set<string>()
  for (const members of byGroup.values()) {
    const detection = detectSharedDeviceGroup(members.map(m => ({ playerId: m.player_id, scoringMethod: m.scoring_method === 'paper' ? 'paper' as const : 'digital' as const })))
    if (detection.isSharedDevice) {
      if (detection.digitalPlayerId) sharedDevicePlayerIds.add(detection.digitalPlayerId)
      if (detection.paperPlayerId) sharedDevicePlayerIds.add(detection.paperPlayerId)
    }
  }

  // P0 trace — instrument before changing logic, per the reported
  // production case: My HQ's own summary already correctly showed 100%
  // Complete / 0 Reconciling for this exact round, yet this close gate
  // still returned "Some holes are still awaiting marker entries." for
  // a shared-device pair. Logs the exact same fields the tournament
  // route's trace does, per-scorecard, so a failing close attempt can
  // be compared directly against My HQ's own trace for the same round
  // instead of inferred from screenshots taken minutes apart.
  for (const sc of scRes.data ?? []) {
    const selfHoles = new Set<string>()
    const markerHoles = new Set<string>()
    for (const e of sc.score_entries ?? []) {
      if (e.capture_role === 'self') selfHoles.add(e.hole_id)
      else if (e.capture_role === 'marker') markerHoles.add(e.hole_id)
    }
    let markerHoleCountForSelfHoles = 0
    for (const holeId of selfHoles) { if (markerHoles.has(holeId)) markerHoleCountForSelfHoles++ }

    const isSharedDevice = sharedDevicePlayerIds.has(sc.player_id)
    console.log('[close-round completion trace]', {
      roundId, playerId: sc.player_id, scoringMethod: sc.scoring_method, groupId: sc.group_id,
      selfHoleCount: selfHoles.size, markerHoleCountForSelfHoles, totalHoles, isMarkerMode,
      isSharedDevice, sharedDevicePlayerIds: [...sharedDevicePlayerIds],
    })

    const result = checkRoundCompletion(
      [{
        scoringMethod: sc.scoring_method === 'paper' ? 'paper' : 'digital',
        selfHoleCount: selfHoles.size, markerHoleCountForSelfHoles, totalHoles,
        isSharedDevice,
      }],
      isMarkerMode,
    )
    if (result) {
      // debug field pattern — surfaces exactly why this scorecard
      // blocked (not just the user-facing reason) without permanently
      // exposing internals: only present on an actual block, and only
      // the fields needed to diagnose a shared-device detection miss.
      return NextResponse.json({
        error: result.reason,
        debug: {
          playerId: sc.player_id, scoringMethod: sc.scoring_method, groupId: sc.group_id,
          isSharedDevice, selfHoleCount: selfHoles.size, markerHoleCountForSelfHoles, totalHoles, isMarkerMode,
        },
      }, { status: 409 })
    }
  }

  const { error: updateError } = await admin.from('rounds').update({ status: 'completed' }).eq('id', roundId)
  if (updateError) {
    console.error('[close-round]', updateError)
    return NextResponse.json({ error: 'Could not close the round.' }, { status: 500 })
  }

  // Automatic lifecycle: LIVE -> COMPLETED, only once every round on this
  // trip is complete — not merely because this one just finished. This
  // is the explicit "do not mark a multi-round trip completed simply
  // because Round 1 finishes" requirement. Derived directly from
  // rounds.status (the existing source of truth for round completion),
  // not a second/parallel completion flag — a trip with any round still
  // 'upcoming' or 'active' is not marked complete. Best-effort and
  // silent, matching the same reasoning as the other lifecycle hooks:
  // the round has already successfully closed, and this must not roll
  // that back over a trip-level label.
  const allRoundsRes = await admin.from('rounds').select('status').eq('trip_id', tripId)
  const allRoundsComplete = (allRoundsRes.data ?? []).length > 0
    && (allRoundsRes.data ?? []).every((r: { status: string }) => r.status === 'completed')
  if (allRoundsComplete) {
    const { error: tripCompleteError } = await admin.from('trips').update({ status: 'completed' }).eq('id', tripId)
    if (tripCompleteError) {
      console.error('[close-round] live->completed transition failed', tripCompleteError)
    }
  }

  return NextResponse.json({ ok: true })
}
