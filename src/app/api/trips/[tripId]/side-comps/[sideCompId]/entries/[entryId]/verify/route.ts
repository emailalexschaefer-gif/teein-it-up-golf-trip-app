/**
 * POST /api/trips/[tripId]/side-comps/[sideCompId]/entries/[entryId]/verify
 *
 * The only write path for turning a pending Side Game claim into an
 * official result (or a rejection). p_verifier_id is always the
 * authenticated user's own id — never taken from the request body — so
 * there is no path by which one player could verify as someone else.
 * The actual authority check (does this user match the claim's
 * snapshotted required_verifier_id, or are they a trip organiser) lives
 * inside the RPC itself (migration 047), not duplicated here — this
 * route's job is to resolve which RPC applies (value-based vs Longest
 * Drive's ordinal model) and forward exactly what it decides.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveSharedDeviceGroupForPlayer } from '@/lib/scoring/resolveSharedDeviceGroup'

interface RouteProps { params: Promise<{ tripId: string; sideCompId: string; entryId: string }> }

// New Chat distribution rule (Packages 1+2 final corrective) — do not
// dump every captured event into Chat; automatically publish only
// high-signal conversation starters, explicitly limited here to
// verified Side Game lead changes. Reuses the exact event_messages
// insert pattern already proven for Moments (moments/route.ts) rather
// than a new posting mechanism — Chat needs no second feed or parallel
// query, this is just another row in the same table. Deliberately
// best-effort: if this insert fails, the verification itself still
// succeeds and is returned to the caller unaffected — a missing chat
// announcement is a lesser failure than losing a verification.
const COMP_TYPE_LABEL: Record<string, string> = {
  nearest_pin: 'Nearest the Pin', pros_approach: 'Pro\u2019s Approach', longest_drive: 'Longest Drive',
}

/**
 * Release 2, item 2 — Side Game photo + lead-change announcement become
 * one Moment, not two separate Chat feed items.
 *
 * Root cause found by inspection first, per the explicit instruction:
 * the underlying data association for this already existed —
 * event_messages.moment_id (migration 028) was added specifically so a
 * captured Moment gets "ALSO a corresponding event_messages row." What
 * was missing was this function's own awareness of it: it always
 * INSERTed a brand new, unlinked 'announcement' row, regardless of
 * whether a photo Moment (and its own 'moment'-type event_messages row)
 * already existed for this exact claim — "Capture the Moment" is
 * prompted at SUBMISSION time (SideCompEntryPanel's
 * onWouldLeadIfVerified), well before verification runs this function,
 * so by the time a claim is actually verified, a linked Moment very
 * often already exists.
 *
 * Fixed by checking side_comp_entries.moment_id first: if a Moment is
 * already linked to this claim, its EXISTING event_messages row is
 * UPDATEd in place to carry the lead-change context ("🎯 NEW NEAREST
 * THE PIN LEADER / Darren Lappen takes the lead — Hole 10") instead of
 * a second, separate row being created — the photo becomes the primary
 * visual with the announcement as attached context, exactly as
 * requested, and this is a genuine data-level merge (one row, one
 * moment_id), not two adjacent Chat items visually stitched together.
 * If no Moment is linked (no photo was captured for this claim), this
 * falls back to the original standalone announcement behaviour
 * unchanged — never a broken or missing announcement.
 *
 * This same event_messages row (moment_id intact either way) is what
 * Round Highlights, My Golf, and Event Story already read from for a
 * Moment — none of them need separate changes to inherit this fix,
 * since they consume the row this function writes to, not a duplicate.
 */
async function postLeadChangeAnnouncement(
  admin: ReturnType<typeof createAdminClient>, tripId: string, verifierId: string,
  compType: string, holeNumber: number | null, leaderName: string | null,
  linkedMomentId: string | null,
) {
  if (!leaderName) return
  const label = COMP_TYPE_LABEL[compType] ?? compType
  const holeText = holeNumber ? ` on Hole ${holeNumber}` : ''
  const icon = compType === 'longest_drive' ? '💥' : '🎯'
  // No literal newline — the Chat feed's message <p> doesn't set
  // white-space: pre-wrap, so a \n here would just collapse to a
  // space, not the two-line "NEW LEADER" / "takes the lead" layout
  // shown in the brief's example. One line reads just as clearly here.
  const announcementText = `${icon} NEW ${label.toUpperCase()} LEADER — ${leaderName} takes the lead${holeText}.`

  if (linkedMomentId) {
    const existingRes = await admin.from('event_messages').select('id').eq('moment_id', linkedMomentId).eq('message_type', 'moment').maybeSingle()
    if (existingRes.data) {
      const { error: updateError } = await admin.from('event_messages').update({ message: announcementText }).eq('id', existingRes.data.id)
      if (updateError) {
        console.error('[side-comp verify] merging lead-change into existing Moment failed (verification itself still saved)', { code: updateError.code, message: updateError.message })
      }
      return
    }
    // moment_id was set on the entry but the expected event_messages row
    // wasn't found (shouldn't happen given migration 028's own
    // guarantee, but not assumed) — fall through to the standalone
    // announcement below rather than silently posting nothing.
  }

  const payload = {
    trip_id: tripId, sender_user_id: verifierId, message_type: 'announcement',
    recipient_type: 'all', recipient_group_id: null,
    message: `${icon} ${leaderName} takes the ${label} lead${holeText}.`,
  }
  let { error } = await admin.from('event_messages').insert(payload)
  if (error && error.code === '23514' && payload.recipient_type === 'all') {
    const retry = await admin.from('event_messages').insert({ ...payload, recipient_type: 'event' })
    error = retry.error
  }
  if (error) console.error('[side-comp verify] lead-change chat announcement failed (verification itself still saved)', { code: error.code, message: error.message })
}

export async function POST(req: NextRequest, { params }: RouteProps) {
  const { tripId, sideCompId, entryId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  type AdminClient = ReturnType<typeof createAdminClient>
  const admin: AdminClient = createAdminClient()

  const memberCheck = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberCheck.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

  const compRes = await admin.from('side_comps').select('id, comp_type, trip_id, hole_number, round_id').eq('id', sideCompId).maybeSingle()
  if (!compRes.data || compRes.data.trip_id !== tripId) {
    return NextResponse.json({ error: 'Side competition not found.' }, { status: 404 })
  }

  const entryRes = await admin.from('side_comp_entries').select('id, side_comp_id, required_verifier_id, moment_id').eq('id', entryId).maybeSingle()
  if (!entryRes.data || entryRes.data.side_comp_id !== sideCompId) {
    return NextResponse.json({ error: 'Claim not found.' }, { status: 404 })
  }

  // P0 fix — shared-device same-phone verification. A paper player
  // (e.g. Marnie) has no account/session of her own, so
  // required_verifier_id can legitimately be her profile id while the
  // only person who can ever physically tap "verify" is her digital
  // partner (Alex), on the one shared phone. The normal invariant this
  // route documents at the top — p_verifier_id is always the
  // authenticated caller's own id — still holds for every other case;
  // this is a narrow, explicitly server-validated exception, never
  // trusted from the request body: only triggers when the caller is
  // independently confirmed (via the same detectSharedDeviceGroup rule
  // used everywhere else) to be the digital half of a genuine
  // shared-device pair with this specific claim's actual required
  // verifier. If the caller already IS the required verifier (the
  // overwhelmingly common case — includes the reverse direction, Alex
  // verifying a claim Marnie "made" that resolved to Alex as her
  // marker), this resolves to the caller's own id and behaves exactly
  // as before.
  let verifierId = user.id
  let verifyingAsSharedDevicePartner = false
  if (entryRes.data.required_verifier_id && entryRes.data.required_verifier_id !== user.id) {
    // P0 root-cause fix — resolved via the LIVE trip_members.group_id
    // (not scorecards.group_id, which the current begin_round() RPC
    // never actually writes — see resolveSharedDeviceGroup.ts's header
    // for the full trace of why that column can't be trusted). Same
    // resolver every other shared-device check now shares.
    const detection = await resolveSharedDeviceGroupForPlayer(admin, { tripId, roundId: compRes.data.round_id, playerId: user.id })
    if (detection.isSharedDevice && detection.digitalPlayerId === user.id && detection.paperPlayerId === entryRes.data.required_verifier_id) {
      verifierId = entryRes.data.required_verifier_id
      verifyingAsSharedDevicePartner = true
    }
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const decision = body.decision
  if (decision !== 'confirm' && decision !== 'correct' && decision !== 'reject') {
    return NextResponse.json({ error: 'Invalid verification decision.' }, { status: 400 })
  }

  if (compRes.data.comp_type === 'nearest_pin' || compRes.data.comp_type === 'pros_approach') {
    let correctedValue: number | null = null
    if (decision === 'correct') {
      correctedValue = typeof body.correctedValue === 'number' ? body.correctedValue : null
      if (correctedValue === null || !Number.isFinite(correctedValue) || correctedValue <= 0) {
        return NextResponse.json({ error: 'Enter a valid corrected distance.' }, { status: 400 })
      }
    }
    const { data, error } = await admin.rpc('verify_side_comp_value_entry', {
      p_entry_id: entryId, p_verifier_id: verifierId, p_decision: decision, p_corrected_value: correctedValue,
    })
    if (error) {
      console.error('[side-comp verify] verify_side_comp_value_entry failed', { entryId, error: error.message })
      const isAuthError = error.message.includes('Only the assigned verifier')
      return NextResponse.json({ error: isAuthError ? "You're not the verifier for this claim." : "Couldn't save this verification. Please try again." }, { status: isAuthError ? 403 : 500 })
    }
    if (verifyingAsSharedDevicePartner) {
      console.log('[side-comp verify] shared-device same-phone verification', { entryId, physicalCaller: user.id, verifiedAs: verifierId })
    }
    const row = data?.[0]
    if (row?.became_official_leader) {
      await postLeadChangeAnnouncement(admin, tripId, verifierId, compRes.data.comp_type, compRes.data.hole_number, row.current_leader_name ?? null, entryRes.data.moment_id ?? null)
    }
    return NextResponse.json({
      entryId: row?.entry_id ?? null,
      verificationStatus: row?.verification_status ?? null,
      resultValue: row?.result_value ?? null,
      becameOfficialLeader: row?.became_official_leader ?? false,
      currentLeader: row?.current_leader_player_id ? { playerId: row.current_leader_player_id, playerName: row.current_leader_name, resultValue: row.current_leader_value } : null,
      leadChangeId: row?.lead_change_id ?? null,
    })
  }

  if (compRes.data.comp_type === 'longest_drive') {
    if (decision === 'correct') {
      return NextResponse.json({ error: "Longest Drive claims can be confirmed or rejected, not numerically corrected." }, { status: 400 })
    }
    const { data, error } = await admin.rpc('verify_longest_drive_entry', {
      p_entry_id: entryId, p_verifier_id: verifierId, p_decision: decision,
    })
    if (error) {
      console.error('[side-comp verify] verify_longest_drive_entry failed', { entryId, error: error.message })
      const isAuthError = error.message.includes('Only the assigned verifier')
      return NextResponse.json({ error: isAuthError ? "You're not the verifier for this claim." : "Couldn't save this verification. Please try again." }, { status: isAuthError ? 403 : 500 })
    }
    if (verifyingAsSharedDevicePartner) {
      console.log('[side-comp verify] shared-device same-phone verification', { entryId, physicalCaller: user.id, verifiedAs: verifierId })
    }
    const row = data?.[0]
    if (row?.became_official_leader) {
      await postLeadChangeAnnouncement(admin, tripId, verifierId, compRes.data.comp_type, compRes.data.hole_number, row.current_leader_name ?? null, entryRes.data.moment_id ?? null)
    }
    return NextResponse.json({
      entryId: row?.entry_id ?? null,
      verificationStatus: row?.verification_status ?? null,
      becameOfficialLeader: row?.became_official_leader ?? false,
      currentLeader: row?.current_leader_player_id ? { playerId: row.current_leader_player_id, playerName: row.current_leader_name, resultValue: null } : null,
      leadChangeId: row?.lead_change_id ?? null,
    })
  }

  return NextResponse.json({ error: 'Unsupported competition type.' }, { status: 400 })
}
