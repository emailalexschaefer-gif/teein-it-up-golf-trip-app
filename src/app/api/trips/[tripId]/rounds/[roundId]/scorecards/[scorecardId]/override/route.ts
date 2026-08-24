/**
 * POST /api/trips/[tripId]/rounds/[roundId]/scorecards/[scorecardId]/override
 * Body: { holeNumber: number, grossScore: number | null, isNoReturn: boolean, reason: string }
 *
 * Priority 6 — treated as high-integrity throughout: organiser-only,
 * requires a non-empty reason, and every override writes a permanent
 * row to score_override_audit before/alongside updating the live score
 * — old value, new value, who, when, reason, all captured, none of it
 * inferred after the fact.
 *
 * Deliberately updates the existing capture_role = 'self' row (creating
 * one if it never existed — the "lost/dead phone" case, where no score
 * was ever entered at all) rather than introducing a separate override
 * table that the rest of the app would need to know to check. This is
 * what makes "admin override becomes authoritative for reconciliation"
 * and "recalculate Stableford/leaderboards/results" true automatically:
 * the existing compute_stableford trigger fires on this exact UPDATE
 * (BEFORE UPDATE OF gross_score, is_no_return — migration 000), and
 * every leaderboard/results/reconciliation query already reads
 * capture_role = 'self' as authoritative (an established convention
 * throughout this app, not something introduced here).
 *
 * Package 3 P0 corrective — confirmed and left unchanged: this route
 * has never checked scorecards.status. It writes score_entries directly
 * regardless of whether the player's card is 'active' or 'completed',
 * so an organiser correction already works on an already-finalised
 * scorecard with no separate unlock step required — exactly the
 * simplified "find player -> correct -> Confirm & Save -> done" flow
 * requested. The scorecard's own lock state is intentionally left
 * completely untouched by this route either way (the organiser's
 * correction doesn't reopen or reset the player's own confirmation),
 * which is also correct: reconciliation status now instead comes from
 * admin_overridden (see the tournament route's own comment on this),
 * not from the scorecard's lock state.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { applyHoleOverride } from '@/lib/scoring/applyHoleOverride'

interface RouteProps { params: Promise<{ tripId: string; roundId: string; scorecardId: string }> }

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
  const holeNumber = typeof body.holeNumber === 'number' ? body.holeNumber : null
  const grossScore = typeof body.grossScore === 'number' ? body.grossScore : null
  const isNoReturn = body.isNoReturn === true
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''

  if (holeNumber === null) return NextResponse.json({ error: 'A hole number is required.' }, { status: 400 })
  if (!isNoReturn && (grossScore === null || grossScore < 1 || grossScore > 20)) {
    return NextResponse.json({ error: 'Enter a valid gross score between 1 and 20, or mark as no return.' }, { status: 400 })
  }
  if (reason.length === 0) {
    return NextResponse.json({ error: 'A reason is required for every score override.' }, { status: 400 })
  }

  const scorecardCheck = await admin.from('scorecards').select('id, round_id').eq('id', scorecardId).maybeSingle()
  if (!scorecardCheck.data || scorecardCheck.data.round_id !== roundId) {
    return NextResponse.json({ error: 'Scorecard not found.' }, { status: 404 })
  }

  const result = await applyHoleOverride(admin, scorecardId, roundId, holeNumber, grossScore, isNoReturn, reason, user.id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json({ ok: true, scoreEntryId: result.scoreEntryId })
}
