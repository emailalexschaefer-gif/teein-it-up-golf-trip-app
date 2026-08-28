/**
 * POST /api/trips/[tripId]/side-comps/[sideCompId]/entries
 *
 * Submits (or corrects) the authenticated player's own CLAIM for a Side
 * Competition — Stage 2 of Side Game Marker Verification. Who may
 * submit: the player themselves, always — `playerId` is never taken
 * from the request body, only from the authenticated session.
 *
 * Since migration 047, submission NEVER decides official leadership —
 * it creates a pending claim and returns wouldLeadIfVerified (a
 * deliberately distinct concept from becameOfficialLeader, which only
 * ever comes from the verification endpoint, not this one). The RPCs
 * (submit_side_comp_value_entry / submit_longest_drive_entry) resolve
 * the required verifier via the round_markers -> organiser -> co-player
 * -> self hierarchy and snapshot it onto the claim — this route doesn't
 * duplicate that logic, it only forwards the RPC's own decision.
 *
 * Idempotent by construction, same as before: UNIQUE(side_comp_id,
 * player_id) means a resubmission is always an UPDATE of the same row.
 * A resubmission while still pending just updates the claim value in
 * place; a resubmission of an already-verified/rejected claim starts a
 * genuinely new pending cycle (handled inside the RPC, not here).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteProps { params: Promise<{ tripId: string; sideCompId: string }> }

export async function GET(req: NextRequest, { params }: RouteProps) {
  const { tripId, sideCompId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  type AdminClient = ReturnType<typeof createAdminClient>
  const admin: AdminClient = createAdminClient()

  const memberCheck = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberCheck.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

  const compRes = await admin.from('side_comps').select('id, comp_type, trip_id, round_id').eq('id', sideCompId).maybeSingle()
  if (!compRes.data || compRes.data.trip_id !== tripId) {
    return NextResponse.json({ error: 'Side competition not found.' }, { status: 404 })
  }

  // Side Games proxy entry — same group/round validation as the POST
  // handler, reused rather than reimplemented, so GET (used to show
  // "does this player already have an entry here?" when the "Result
  // for" selector changes) can't be used to probe an arbitrary event
  // player's claim either.
  const requestedGetPlayerId = req.nextUrl.searchParams.get('playerId')
  let viewPlayerId = user.id
  if (requestedGetPlayerId && requestedGetPlayerId !== user.id) {
    const [submitterMember, nomineeMember] = await Promise.all([
      admin.from('trip_members').select('group_id').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle(),
      admin.from('trip_members').select('group_id').eq('trip_id', tripId).eq('profile_id', requestedGetPlayerId).maybeSingle(),
    ])
    const submitterGroupId = submitterMember.data?.group_id ?? null
    const nomineeGroupId = nomineeMember.data?.group_id ?? null
    if (nomineeMember.data && submitterGroupId && nomineeGroupId && submitterGroupId === nomineeGroupId) {
      viewPlayerId = requestedGetPlayerId
    }
    // Silently falls back to viewing the submitter's own entry if the
    // nominee isn't a valid, same-group player — never errors here,
    // since a stale/invalid selector value in the client shouldn't
    // break the read path the way it correctly blocks the write path.
  }

  // The caller's own existing claim — so re-visiting the hole shows
  // exactly what they already answered, including its current
  // verification state, and a resubmission is understood as a
  // correction rather than a fresh attempt. Read-only here; the RPCs
  // are the only write path.
  const myEntryRes = await admin.from('side_comp_entries')
    .select('id, qualified, claimed_value, result_value, verification_status, required_verifier_id')
    .eq('side_comp_id', sideCompId).eq('player_id', viewPlayerId).maybeSingle()
  // Current OFFICIAL leader — verified entries only. This is the one
  // place migration 047's own noted follow-up (adding explicit
  // `result_value IS NOT NULL` guards rather than relying on implicit
  // NULLS-LAST ordering) is applied, since this route's reads were
  // never rewritten by that migration itself.
  let currentLeader: { playerId: string; playerName: string; resultValue: number | null } | null = null
  if (compRes.data.comp_type === 'longest_drive') {
    const { data: changes } = await admin
      .from('side_comp_lead_changes')
      .select('player_id, sequence_number')
      .eq('side_comp_id', sideCompId)
      .order('sequence_number', { ascending: false })
    for (const change of (changes ?? []) as { player_id: string }[]) {
      const { data: entry } = await admin
        .from('side_comp_entries').select('qualified, verification_status')
        .eq('side_comp_id', sideCompId).eq('player_id', change.player_id).maybeSingle()
      if (entry?.qualified && entry.verification_status === 'verified') {
        const { data: profile } = await admin.from('profiles').select('full_name').eq('id', change.player_id).maybeSingle()
        currentLeader = { playerId: change.player_id, playerName: profile?.full_name ?? 'Player', resultValue: null }
        break
      }
    }
  } else {
    const { data } = await admin
      .from('side_comp_entries')
      .select('player_id, result_value, profiles:player_id(full_name)')
      .eq('side_comp_id', sideCompId).eq('qualified', true).eq('verification_status', 'verified')
      .not('result_value', 'is', null)
      .order('result_value', { ascending: true })
      .limit(1)
    const row = (data ?? [])[0] as unknown as { player_id: string; result_value: number; profiles: { full_name: string } | null } | undefined
    if (row) currentLeader = { playerId: row.player_id, playerName: row.profiles?.full_name ?? 'Player', resultValue: row.result_value }
  }

  return NextResponse.json({
    myEntry: myEntryRes.data ? {
      entryId: myEntryRes.data.id,
      qualified: myEntryRes.data.qualified,
      claimedValue: myEntryRes.data.claimed_value,
      resultValue: myEntryRes.data.result_value,
      verificationStatus: myEntryRes.data.verification_status,
      // P0 follow-up — needed so the claimant's own panel can tell
      // whether ITS OWN pending claim requires the shared-device paper
      // partner's confirmation (compared against sharedDevicePartnerId,
      // passed down from the scoring shell), and render the inline
      // same-phone verification action directly here rather than only
      // in the separate PendingVerificationCard elsewhere on the page.
      requiredVerifierId: myEntryRes.data.required_verifier_id,
    } : null,
    currentLeader,
  })
}

export async function POST(req: NextRequest, { params }: RouteProps) {
  const { tripId, sideCompId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  type AdminClient = ReturnType<typeof createAdminClient>
  const admin: AdminClient = createAdminClient()

  const memberCheck = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberCheck.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

  const compRes = await admin.from('side_comps').select('id, comp_type, trip_id, round_id, enabled').eq('id', sideCompId).maybeSingle()
  if (!compRes.data || compRes.data.trip_id !== tripId) {
    return NextResponse.json({ error: 'Side competition not found.' }, { status: 404 })
  }
  if (!compRes.data.enabled) {
    return NextResponse.json({ error: 'This competition is not active.' }, { status: 409 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  // Side Games proxy entry — "result for" a nominated player, defaulting
  // to the submitter themselves (the overwhelmingly common case, and
  // deliberately identical in cost/behaviour to before this feature —
  // an ordinary self-entry never even reaches the extra query below).
  // Server-side validated regardless of what the client dropdown showed,
  // per the explicit "do not rely only on the dropdown filtering"
  // instruction: a client cannot manipulate this to submit results for
  // an arbitrary event player just by changing the request body, since
  // eligibility is re-checked here from real trip_members/group data,
  // not trusted from the request.
  const requestedPlayerId = typeof body.playerId === 'string' ? body.playerId : user.id
  let playerId = user.id
  if (requestedPlayerId !== user.id) {
    const [submitterMember, nomineeMember] = await Promise.all([
      admin.from('trip_members').select('group_id').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle(),
      admin.from('trip_members').select('group_id').eq('trip_id', tripId).eq('profile_id', requestedPlayerId).maybeSingle(),
    ])
    const submitterGroupId = submitterMember.data?.group_id ?? null
    const nomineeGroupId = nomineeMember.data?.group_id ?? null
    if (!nomineeMember.data) {
      return NextResponse.json({ error: 'That player is not part of this event.' }, { status: 403 })
    }
    if (!submitterGroupId || !nomineeGroupId || submitterGroupId !== nomineeGroupId) {
      return NextResponse.json({ error: 'You can only enter a result for someone in your own playing group.' }, { status: 403 })
    }
    // Nominee must genuinely have a scorecard for this specific round —
    // matches "nominated player belongs to the same event/round" and
    // "nominated player is eligible for that Side Game" without
    // inventing a separate eligibility concept; a scorecard for this
    // round is the same participation signal every other Side Games
    // path already uses.
    const nomineeScorecard = await admin.from('scorecards').select('id').eq('round_id', compRes.data.round_id).eq('player_id', requestedPlayerId).maybeSingle()
    if (!nomineeScorecard.data) {
      return NextResponse.json({ error: 'That player is not in this round.' }, { status: 403 })
    }
    playerId = requestedPlayerId
  }

  const qualified = body.qualified === true

  if (compRes.data.comp_type === 'nearest_pin' || compRes.data.comp_type === 'pros_approach') {
    const resultValue = typeof body.resultValue === 'number' ? body.resultValue : null
    if (qualified && (resultValue === null || !Number.isFinite(resultValue) || resultValue <= 0)) {
      return NextResponse.json({ error: 'Enter a valid distance from the pin.' }, { status: 400 })
    }
    const { data, error } = await admin.rpc('submit_side_comp_value_entry', {
      // Side Games proxy entry — p_player_id is now the validated
      // nominated player (self by default), p_entered_by is always the
      // real, authenticated submitter regardless of who the result is
      // for. This is the exact distinction the RPC already supported
      // (both parameters existed before this feature; this route simply
      // no longer hardcodes them to the same value).
      p_side_comp_id: sideCompId, p_player_id: playerId,
      p_qualified: qualified, p_result_value: qualified ? resultValue : null,
      p_entered_by: user.id,
    })
    if (error) {
      console.error('[side-comp entries] submit_side_comp_value_entry failed', { sideCompId, error: error.message })
      return NextResponse.json({ error: error.message.includes('not currently active') ? 'This round is not currently active.' : "Couldn't save your result. Please try again." }, { status: error.message.includes('not currently active') ? 409 : 500 })
    }
    const row = data?.[0]
    return NextResponse.json({
      entryId: row?.entry_id ?? null,
      verificationStatus: row?.verification_status ?? 'pending',
      wouldLeadIfVerified: row?.would_lead_if_verified ?? false,
      requiredVerifierId: row?.required_verifier_id ?? null,
      verifierSource: row?.verifier_source ?? null,
      currentLeader: row?.current_leader_player_id ? { playerId: row.current_leader_player_id, playerName: row.current_leader_name, resultValue: row.current_leader_value } : null,
    })
  }

  if (compRes.data.comp_type === 'longest_drive') {
    const claimsBeatLead = body.claimsBeatLeader === true
    const { data, error } = await admin.rpc('submit_longest_drive_entry', {
      p_side_comp_id: sideCompId, p_player_id: playerId,
      p_qualified: qualified, p_claims_beat_lead: claimsBeatLead,
      p_entered_by: user.id,
    })
    if (error) {
      console.error('[side-comp entries] submit_longest_drive_entry failed', { sideCompId, error: error.message })
      return NextResponse.json({ error: error.message.includes('not currently active') ? 'This round is not currently active.' : "Couldn't save your result. Please try again." }, { status: error.message.includes('not currently active') ? 409 : 500 })
    }
    const row = data?.[0]
    return NextResponse.json({
      entryId: row?.entry_id ?? null,
      verificationStatus: row?.verification_status ?? 'pending',
      wouldLeadIfVerified: row?.would_lead_if_verified ?? false,
      requiredVerifierId: row?.required_verifier_id ?? null,
      verifierSource: row?.verifier_source ?? null,
      currentLeader: row?.current_leader_player_id ? { playerId: row.current_leader_player_id, playerName: row.current_leader_name, resultValue: null } : null,
    })
  }

  return NextResponse.json({ error: 'Unsupported competition type.' }, { status: 400 })
}
