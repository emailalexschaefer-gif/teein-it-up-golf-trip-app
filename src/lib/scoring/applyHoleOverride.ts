/**
 * Core "apply one hole's organiser override" logic — extracted from the
 * original single-hole override/route.ts (Package 3A) so the new
 * multi-hole batch-override route (Package 3 final) reuses the exact
 * same write path rather than a second, independently-maintained copy.
 * Anything that changes how an override is applied only needs to
 * change here.
 *
 * Deliberately updates the existing capture_role = 'self' row (creating
 * one if it never existed — the "lost/dead phone" case) rather than a
 * separate override table. This is what makes "admin override becomes
 * authoritative for reconciliation" and "recalculate Stableford/
 * leaderboards/results" true automatically: the existing
 * compute_stableford trigger fires on this exact UPDATE (BEFORE UPDATE
 * OF gross_score, is_no_return — migration 000), and every leaderboard/
 * results/reconciliation query already reads capture_role = 'self' as
 * authoritative.
 */
import { randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export interface OverrideResult { ok: true; scoreEntryId: string }
export interface OverrideFailure { ok: false; error: string }

export async function applyHoleOverride(
  admin: AdminClient, scorecardId: string, roundId: string,
  holeNumber: number, grossScore: number | null, isNoReturn: boolean, reason: string, userId: string,
): Promise<OverrideResult | OverrideFailure> {
  const holeRes = await admin.from('holes').select('id').eq('round_id', roundId).eq('hole_number', holeNumber).maybeSingle()
  if (!holeRes.data) return { ok: false, error: `Hole ${holeNumber} not found for this round.` }
  const holeId = holeRes.data.id

  const existingRes = await admin
    .from('score_entries')
    .select('id, gross_score, is_no_return')
    .eq('scorecard_id', scorecardId).eq('hole_id', holeId).eq('capture_role', 'self')
    .maybeSingle()

  const finalGross = isNoReturn ? 1 : (grossScore as number)

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
      return { ok: false, error: `Couldn't save Hole ${holeNumber}. Please try again.` }
    }
  } else {
    const { data: inserted, error: insertError } = await admin
      .from('score_entries')
      .insert({
        scorecard_id: scorecardId, hole_id: holeId, capture_role: 'self',
        gross_score: finalGross, is_no_return: isNoReturn,
        entered_by: userId, client_id: randomUUID(), admin_overridden: true,
      })
      .select('id').single()
    if (insertError || !inserted) {
      console.error('[score override] insert failed', { scorecardId, holeId, error: insertError?.message })
      return { ok: false, error: `Couldn't save Hole ${holeNumber}. Please try again.` }
    }
    scoreEntryId = inserted.id
  }

  const { error: auditError } = await admin.from('score_override_audit').insert({
    score_entry_id: scoreEntryId, scorecard_id: scorecardId, hole_id: holeId,
    old_gross_score: oldGross, new_gross_score: finalGross,
    old_is_no_return: oldNoReturn, new_is_no_return: isNoReturn,
    reason, overridden_by: userId,
  })
  if (auditError) {
    // Same reasoning as the original single-hole route: the score
    // change already succeeded — a failed audit insert is logged
    // loudly but does not roll back the correction itself.
    console.error('[score override] AUDIT ROW FAILED — score itself was already updated', { scoreEntryId, scorecardId, holeId, error: auditError.message })
  }

  return { ok: true, scoreEntryId }
}
