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

  // Server-side completion guard — authoritative, not inferred from any
  // client-reported readiness state. Checks four things per scorecard:
  // every hole has a self entry; in self_and_marker mode, every hole also
  // has a marker entry; self and marker values actually agree (not just
  // "both present" — a genuine unresolved mismatch previously slipped
  // through here); and the player has completed their own final
  // confirmation (scorecards.status = 'completed', the lock from the
  // Round Summary confirmation flow) — reusing that existing state
  // rather than inventing a second "ready" concept.
  const scRes = await admin.from('scorecards')
    .select('id, status, score_entries ( hole_id, gross_score, is_no_return, capture_role )')
    .eq('round_id', roundId).neq('status', 'withdrawn')

  const totalHoles = roundRes.data.holes ?? 18
  const isMarkerMode = roundRes.data.score_capture_mode === 'self_and_marker'

  for (const sc of scRes.data ?? []) {
    const selfByHole = new Map<string, { gross_score: number | null; is_no_return: boolean }>()
    const markerByHole = new Map<string, { gross_score: number | null; is_no_return: boolean }>()
    for (const e of sc.score_entries ?? []) {
      if (e.capture_role === 'self') selfByHole.set(e.hole_id, e)
      else if (e.capture_role === 'marker') markerByHole.set(e.hole_id, e)
    }
    if (selfByHole.size < totalHoles) {
      return NextResponse.json({ error: 'Not every player has finished scoring yet.' }, { status: 409 })
    }
    if (isMarkerMode) {
      for (const [holeId, self] of selfByHole) {
        const marker = markerByHole.get(holeId)
        if (!marker) {
          return NextResponse.json({ error: 'Some holes are still awaiting marker entries.' }, { status: 409 })
        }
        const differs = self.is_no_return !== marker.is_no_return
          || (!self.is_no_return && self.gross_score !== marker.gross_score)
        if (differs) {
          return NextResponse.json({ error: 'One or more scores still have an unresolved mismatch between the player and marker.' }, { status: 409 })
        }
      }
    }
    if (sc.status !== 'completed') {
      return NextResponse.json({ error: 'One or more players have not yet confirmed their final scores.' }, { status: 409 })
    }
  }

  const { error: updateError } = await admin.from('rounds').update({ status: 'completed' }).eq('id', roundId)
  if (updateError) {
    console.error('[close-round]', updateError)
    return NextResponse.json({ error: 'Could not close the round.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
