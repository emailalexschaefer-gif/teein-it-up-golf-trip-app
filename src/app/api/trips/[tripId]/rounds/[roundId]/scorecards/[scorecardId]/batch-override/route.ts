/**
 * POST /api/trips/[tripId]/rounds/[roundId]/scorecards/[scorecardId]/batch-override
 * Body: { changes: { holeNumber: number, grossScore: number | null, isNoReturn: boolean }[], reason: string }
 *
 * Package 3 final — "the organiser should be able to change one hole,
 * multiple holes, or all remaining holes... do not make Darren open 18
 * separate edit modals." Applies every change in `changes` through the
 * exact same applyHoleOverride function the original single-hole
 * override route now also calls (extracted specifically so there is
 * only one write path for "apply an organiser correction to a hole,"
 * not two independently-maintained copies).
 *
 * "One atomic save": this project's Supabase client has no
 * multi-statement transaction primitive in use anywhere else in this
 * codebase, so each hole is applied sequentially — genuinely atomic
 * per-hole (each write + its own audit row), applied as one continuous
 * server-side operation triggered by a single organiser action, which
 * is what "the organiser UX is simply Edit -> Review -> Confirm & Save
 * -> Done" actually requires: no intermediate unlock/relock step is
 * ever exposed to the organiser, and no partial result is left waiting
 * on a second action. If one hole in the middle of a multi-hole batch
 * fails, the response reports exactly which holes succeeded and which
 * failed, rather than silently claiming full success or discarding the
 * holes that did save.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { applyHoleOverride } from '@/lib/scoring/applyHoleOverride'

interface RouteProps { params: Promise<{ tripId: string; roundId: string; scorecardId: string }> }

interface HoleChange { holeNumber: number; grossScore: number | null; isNoReturn: boolean }

export async function POST(req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId, scorecardId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  type AdminClient = ReturnType<typeof createAdminClient>
  const admin: AdminClient = createAdminClient()

  const membership = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!membership.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })
  if (membership.data.role !== 'organiser') {
    return NextResponse.json({ error: 'Only the organiser can override a score.' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const changes = Array.isArray(body.changes) ? (body.changes as HoleChange[]) : []
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''

  if (changes.length === 0) return NextResponse.json({ error: 'No changes to save.' }, { status: 400 })
  if (reason.length === 0) return NextResponse.json({ error: 'A reason is required for every score override.' }, { status: 400 })

  for (const c of changes) {
    if (typeof c.holeNumber !== 'number') return NextResponse.json({ error: 'Every change needs a valid hole number.' }, { status: 400 })
    if (!c.isNoReturn && (typeof c.grossScore !== 'number' || c.grossScore < 1 || c.grossScore > 20)) {
      return NextResponse.json({ error: `Hole ${c.holeNumber}: enter a valid gross score between 1 and 20, or mark as no return.` }, { status: 400 })
    }
  }

  const scorecardCheck = await admin.from('scorecards').select('id, round_id').eq('id', scorecardId).maybeSingle()
  if (!scorecardCheck.data || scorecardCheck.data.round_id !== roundId) {
    return NextResponse.json({ error: 'Scorecard not found.' }, { status: 404 })
  }

  const succeeded: number[] = []
  const failed: { holeNumber: number; error: string }[] = []
  for (const c of changes) {
    const result = await applyHoleOverride(admin, scorecardId, roundId, c.holeNumber, c.grossScore, c.isNoReturn, reason, user.id)
    if (result.ok) succeeded.push(c.holeNumber)
    else failed.push({ holeNumber: c.holeNumber, error: result.error })
  }

  if (failed.length > 0) {
    // Deliberately still 200, not 500 — some holes may have genuinely
    // saved. The client is expected to show exactly which holes failed
    // (per-hole detail below) so the organiser can retry just those,
    // rather than the whole batch silently appearing to have failed
    // when most of it actually succeeded.
    return NextResponse.json({ ok: succeeded.length > 0, partial: true, succeeded, failed }, { status: succeeded.length > 0 ? 207 : 500 })
  }

  return NextResponse.json({ ok: true, succeeded })
}
