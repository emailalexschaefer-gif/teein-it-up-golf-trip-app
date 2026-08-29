/**
 * GET  /api/trips/[tripId]/rounds/[roundId]/playing-partner
 * POST /api/trips/[tripId]/rounds/[roundId]/playing-partner
 * POST body: { partnerId: string }
 *
 * Darren field-test fix (Release 1, item 1) — Playing Partner is now
 * deliberately directional, never reciprocal, and never automatic. The
 * model is exactly: "Choose who you are marking." If Marnie chooses
 * Darren, that creates ONE row — Marnie is Darren's marker — and
 * implies nothing about who marks Marnie. This replaces the previous
 * model, which inserted BOTH directions on every selection (and which
 * Begin Round also did automatically for any 2-player group before
 * this change — see start/route.ts's now-inert autoGenerateMarkers).
 * Reused for every group size uniformly now; there's no longer a
 * "2 players are auto-paired, 3+ choose manually" split — every player,
 * in a group of any size, always makes their own explicit choice.
 *
 * Permissive by design, per the explicit instruction: this does not
 * prevent two different players from both choosing to mark the same
 * person — "golfers can resolve that themselves." The one constraint
 * this route still enforces is the DB's own round_markers UNIQUE
 * (round_id, player_id) constraint, which caps how many markers a
 * single SUBJECT can have recorded at once — see the POST handler
 * below for the full explanation and the conflict this surfaces.
 *
 * GET returns the caller's own status (already marking someone, or
 * not) plus the list of eligible candidates. A solo group correctly
 * returns an empty candidate list, not an error.
 *
 * Darren field-test fix (Release 1, item 2) — "Change who I'm marking."
 * GET now always returns real candidates, even when already paired
 * (candidates used to come back empty in that case, since the only
 * caller was the one-time initial-selection screen). POST is now an
 * upsert rather than insert-only: a caller who's already marking
 * someone is no longer blocked with a 409 — their existing
 * round_markers row is UPDATEd to the new partner instead of a second
 * row being inserted. This only ever touches round_markers.player_id;
 * scorecards and score_entries for every player involved (the caller's
 * own card, the old partner's card, the new partner's card) are never
 * read or written here, so nothing about anyone's already-entered
 * scores, scorecard, or reconciliation history is touched by a change.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  type AdminClient = ReturnType<typeof createAdminClient>
  const admin: AdminClient = createAdminClient()

  const memberCheck = await admin.from('trip_members').select('group_id').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberCheck.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

  const myMarkerRes = await admin.from('round_markers').select('player_id').eq('round_id', roundId).eq('marker_player_id', user.id).maybeSingle()

  if (!memberCheck.data.group_id) {
    if (myMarkerRes.data) {
      const partnerProfile = await admin.from('profiles').select('full_name').eq('id', myMarkerRes.data.player_id).maybeSingle()
      return NextResponse.json({ paired: true, partnerId: myMarkerRes.data.player_id, partnerName: partnerProfile.data?.full_name ?? null, candidates: [] })
    }
    return NextResponse.json({ paired: false, partnerId: null, partnerName: null, candidates: [] })
  }

  // Group-mates who play this round (have a scorecard). Permissive
  // model — candidates are NOT excluded just because someone else has
  // already chosen to mark them (per the explicit instruction not to
  // build matching rules preventing two golfers from selecting the
  // same person). The one thing still excluded is a paper player —
  // unrelated to this feature, a paper player structurally cannot be
  // marked digitally at all, regardless of how permissive the
  // selection model is.
  const [groupMembersRes, cardsRes] = await Promise.all([
    admin.from('trip_members').select('profile_id, profiles ( full_name )').eq('trip_id', tripId).eq('group_id', memberCheck.data.group_id),
    admin.from('scorecards').select('player_id, scoring_method').eq('round_id', roundId).neq('status', 'withdrawn'),
  ])
  const cardPlayerIds = new Set(
    (cardsRes.data ?? [])
      .filter((c: { scoring_method?: string }) => c.scoring_method !== 'paper')
      .map((c: { player_id: string }) => c.player_id)
  )

  // Darren field-test fix (Release 1, item 2) — candidates are now
  // always computed and returned, regardless of whether the caller is
  // already marking someone. Previously this returned an early
  // response with candidates: [] the moment myMarkerRes.data existed,
  // since the only caller was the one-time initial-selection screen,
  // which never needed the list once already paired. "Change who I'm
  // marking" needs that same list available on demand at any point
  // during the round, so the early-return is gone — paired/partnerId/
  // partnerName still reflect current status exactly as before.
  const candidates = ((groupMembersRes.data ?? []) as unknown as { profile_id: string; profiles: { full_name: string } | null }[])
    .filter(m => m.profile_id !== user.id && cardPlayerIds.has(m.profile_id))
    .map(m => ({ id: m.profile_id, name: m.profiles?.full_name ?? 'Player' }))

  if (myMarkerRes.data) {
    const partnerProfile = await admin.from('profiles').select('full_name').eq('id', myMarkerRes.data.player_id).maybeSingle()
    return NextResponse.json({ paired: true, partnerId: myMarkerRes.data.player_id, partnerName: partnerProfile.data?.full_name ?? null, candidates })
  }

  return NextResponse.json({ paired: false, partnerId: null, partnerName: null, candidates })
}

export async function POST(req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  type AdminClient = ReturnType<typeof createAdminClient>
  const admin: AdminClient = createAdminClient()

  const memberCheck = await admin.from('trip_members').select('group_id').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberCheck.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const partnerId = body.partnerId
  if (typeof partnerId !== 'string' || partnerId === user.id) {
    return NextResponse.json({ error: 'Choose a different player as your Playing Partner.' }, { status: 400 })
  }

  const partnerCheck = await admin.from('trip_members').select('group_id').eq('trip_id', tripId).eq('profile_id', partnerId).maybeSingle()
  if (!partnerCheck.data || partnerCheck.data.group_id !== memberCheck.data.group_id || memberCheck.data.group_id === null) {
    return NextResponse.json({ error: 'Your Playing Partner must be in the same group.' }, { status: 400 })
  }

  const partnerCard = await admin.from('scorecards').select('scoring_method').eq('round_id', roundId).eq('player_id', partnerId).maybeSingle()
  if (partnerCard.data?.scoring_method === 'paper') {
    return NextResponse.json({ error: 'This player is using a paper scorecard this round and does not need a digital Playing Partner.' }, { status: 400 })
  }

  // Directional fix — the caller is blocked from choosing again only if
  // THEY are already marking someone (marker_player_id = them). Whether
  // the chosen partner is already being marked by someone else is a
  // separate, permitted fact under the new model — this route does not
  // pre-check or block on it.
  //
  // KNOWN ARCHITECTURAL CONFLICT, reported rather than silently worked
  // around: round_markers has UNIQUE(round_id, player_id) — each
  // SUBJECT can only ever have ONE marker row recorded. That means two
  // different players genuinely cannot BOTH be recorded as marking the
  // same third player at once; the second attempt will fail here with a
  // clear 409, not silently succeed or corrupt data. "Golfers can
  // resolve that themselves" — the request explicitly does not want
  // application-level matching rules preventing the same person being
  // selected, and this change removes that application-level
  // prevention (the GET candidate list above no longer excludes an
  // already-chosen person). But fully supporting two simultaneous
  // markers for the same subject would require relaxing this DB
  // constraint, which affects every other reader of round_markers that
  // currently assumes at most one marker per subject (reconciliation,
  // My HQ, the verify-mode UI) — a change with real regression risk
  // this pass didn't attempt to make blind. Flagging this explicitly
  // rather than choosing silently.
  // Darren field-test fix (Release 1, item 2) — "Change who I'm
  // marking." This used to block a second selection with a 409 the
  // instant existingMine.data existed. Now it's an upsert: if the
  // caller already has a round_markers row, it's UPDATEd to point at
  // the new partner instead of being blocked — this is the actual
  // "change" action, not a new endpoint or a special mode flag. Only
  // round_markers.player_id changes; nothing about scorecards or
  // score_entries for the caller, the old partner, or the new partner
  // is touched here, so all already-entered scores, both scorecards,
  // and any existing reconciliation data survive a change untouched.
  //
  // The remaining, still-real architectural conflict (unchanged from
  // before, still reported rather than silently worked around):
  // round_markers has UNIQUE(round_id, player_id) — each SUBJECT can
  // only ever have ONE marker row recorded. Two different players
  // genuinely cannot both be recorded as marking the same third player
  // at once; whichever one is CHANGED or INSERTED second still fails
  // with a clear 409 below, not silent corruption.
  const existingMine = await admin.from('round_markers').select('id, player_id').eq('round_id', roundId).eq('marker_player_id', user.id).maybeSingle()

  if (existingMine.data) {
    if (existingMine.data.player_id === partnerId) {
      // Already marking this exact person — a no-op, not an error.
      return NextResponse.json({ ok: true, partnerId })
    }
    const { error: updateError } = await admin.from('round_markers').update({ player_id: partnerId }).eq('id', existingMine.data.id)
    if (updateError) {
      console.error('[playing-partner] change (update) failed', { roundId, userId: user.id, partnerId, error: updateError.message })
      const isDuplicateSubject = updateError.message.includes('duplicate key') || updateError.message.includes('round_markers_round_id_player_id')
      return NextResponse.json({
        error: isDuplicateSubject
          ? 'Someone else is already marking this player for this round.'
          : 'Couldn\u2019t change your Playing Partner. Please try again.',
      }, { status: isDuplicateSubject ? 409 : 500 })
    }
    return NextResponse.json({ ok: true, partnerId, changed: true })
  }

  const { error } = await admin.from('round_markers').insert([
    { round_id: roundId, player_id: partnerId, marker_player_id: user.id },
  ])
  if (error) {
    console.error('[playing-partner] insert failed', { roundId, userId: user.id, partnerId, error: error.message })
    const isDuplicateSubject = error.message.includes('duplicate key') || error.message.includes('round_markers_round_id_player_id')
    return NextResponse.json({
      error: isDuplicateSubject
        ? 'Someone else is already marking this player for this round.'
        : 'Couldn\u2019t set your Playing Partner. Please try again.',
    }, { status: isDuplicateSubject ? 409 : 500 })
  }

  return NextResponse.json({ ok: true, partnerId })
}
