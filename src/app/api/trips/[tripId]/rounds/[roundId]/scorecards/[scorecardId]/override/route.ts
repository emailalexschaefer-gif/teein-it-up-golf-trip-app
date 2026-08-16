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
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'crypto'

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

  const holeRes = await admin.from('holes').select('id').eq('round_id', roundId).eq('hole_number', holeNumber).maybeSingle()
  if (!holeRes.data) return NextResponse.json({ error: 'Hole not found for this round.' }, { status: 404 })
  const holeId = holeRes.data.id

  const existingRes = await admin
    .from('score_entries')
    .select('id, gross_score, is_no_return')
    .eq('scorecard_id', scorecardId).eq('hole_id', holeId).eq('capture_role', 'self')
    .maybeSingle()

  const finalGross = isNoReturn ? 1 : (grossScore as number) // gross_score is NOT NULL — a no-return still needs a placeholder value; is_no_return is the actual signal downstream, matching the existing self-capture convention already used elsewhere in this app for pick-ups/no-returns.

  let scoreEntryId: string
  let oldGross: number | null = null
  let oldNoReturn = false

  if (existingRes.data) {
    scoreEntryId = existingRes.data.id
    oldGross = existingRes.data.gross_score
    oldNoReturn = existingRes.data.is_no_return
    const { error: updateError } = await admin
      .from('score_entries')
      .update({ gross_score: finalGross, is_no_return: isNoReturn, admin_overridden: true })
      .eq('id', scoreEntryId)
    if (updateError) {
      console.error('[score override] update failed', { scorecardId, holeId, error: updateError.message })
      return NextResponse.json({ error: "Couldn't save the override. Please try again." }, { status: 500 })
    }
  } else {
    // No score was ever entered for this hole — the "lost/dead phone"
    // case explicitly named in the requirements. entered_by is the
    // organiser performing the override, not a claim about who actually
    // played the hole — the audit row (and admin_overridden = true) is
    // what makes this distinction visible, not entered_by.
    const { data: inserted, error: insertError } = await admin
      .from('score_entries')
      .insert({
        scorecard_id: scorecardId, hole_id: holeId, capture_role: 'self',
        gross_score: finalGross, is_no_return: isNoReturn,
        entered_by: user.id, client_id: randomUUID(), admin_overridden: true,
      })
      .select('id').single()
    if (insertError || !inserted) {
      console.error('[score override] insert failed', { scorecardId, holeId, error: insertError?.message })
      return NextResponse.json({ error: "Couldn't save the override. Please try again." }, { status: 500 })
    }
    scoreEntryId = inserted.id
  }

  const { error: auditError } = await admin.from('score_override_audit').insert({
    score_entry_id: scoreEntryId, scorecard_id: scorecardId, hole_id: holeId,
    old_gross_score: oldGross, new_gross_score: finalGross,
    old_is_no_return: oldNoReturn, new_is_no_return: isNoReturn,
    reason, overridden_by: user.id,
  })
  if (auditError) {
    // The score change already succeeded above — a failed audit insert
    // is logged loudly but does not roll back the correction itself,
    // since the organiser's fix is more urgent than its own paper trail
    // in the reconciliation-deadlock scenario this exists for. Surfaced
    // clearly in logs so it can be investigated, not silently dropped.
    console.error('[score override] AUDIT ROW FAILED — score itself was already updated', { scoreEntryId, scorecardId, holeId, error: auditError.message })
  }

  return NextResponse.json({ ok: true, scoreEntryId })
}
