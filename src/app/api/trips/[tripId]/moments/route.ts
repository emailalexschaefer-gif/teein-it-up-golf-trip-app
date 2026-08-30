/**
 * GET  /api/trips/[tripId]/moments — list moments visible to the caller
 *      (optional ?playerId= filter for My Moments, ?roundId= for a
 *      specific round's Event Story)
 * POST /api/trips/[tripId]/moments — create a moment record, after the
 *      client has already uploaded the image to Supabase Storage
 *      directly (same pattern as the avatar upload flow — the image
 *      itself never passes through this API route).
 *
 * Uses the REGULAR (non-admin) Supabase client for both — RLS on
 * moments already correctly governs who can read/write, same reasoning
 * as the messages route.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteProps { params: Promise<{ tripId: string }> }

export async function GET(req: NextRequest, { params }: RouteProps) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const playerId = req.nextUrl.searchParams.get('playerId')
  const roundId = req.nextUrl.searchParams.get('roundId')

  let query = supabase
    .from('moments')
    .select('id, trip_id, round_id, hole_number, player_id, group_id, caption, image_path, audience, created_at')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false })

  if (playerId) query = query.eq('player_id', playerId)
  if (roundId) query = query.eq('round_id', roundId)

  const { data: moments, error } = await query.limit(100)

  if (error) {
    console.error('[moments GET]', { code: error.code, message: error.message, tripId, userId: user.id })
    return NextResponse.json({ error: 'Moments are temporarily unavailable.' }, { status: 500 })
  }
  if (!moments || moments.length === 0) return NextResponse.json({ moments: [] })

  // Enrich with player name and a signed URL for the (private) image —
  // separate queries merged in JS, the same pattern already established
  // for event_messages, rather than an embedded PostgREST relationship
  // (moments.player_id has the same "which FK" ambiguity risk that broke
  // event_messages GET once already, so this is deliberate, not an
  // oversight).
  const playerIds = [...new Set(moments.map(m => m.player_id))]
  const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', playerIds)
  const nameByPlayerId = new Map<string, string>((profiles ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]))

  const enriched = await Promise.all(moments.map(async (m) => {
    const imageUrl = m.image_path
      ? (await supabase.storage.from('event-moments').createSignedUrl(m.image_path, 3600)).data?.signedUrl ?? null
      : null
    return { ...m, playerName: nameByPlayerId.get(m.player_id) ?? 'Player', imageUrl }
  }))

  return NextResponse.json({ moments: enriched })
}

export async function POST(req: NextRequest, { params }: RouteProps) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { imagePath, caption, roundId, holeNumber, audience, sideCompId, sideCompEntryId, leadChangeId, playerId: requestedPlayerId } = body as {
    imagePath?: string; caption?: string; roundId?: string | null; holeNumber?: number | null; audience?: string
    // Sprint 9 Item 4 — Capture the Moment linking. Only ever present
    // when this Moment was launched from a New Leader prompt (see
    // MomentCapture's sideCompContext prop) — a normal Moment posted
    // from Chat/My Round never sends these.
    sideCompId?: string | null; sideCompEntryId?: string | null; leadChangeId?: string | null
    // Side Games proxy entry — who this Moment is ABOUT, when different
    // from who's uploading it. Defaults to the submitter (every existing
    // caller that doesn't send this behaves identically to before).
    playerId?: string
  }

  // A Moment needs either a photo or a caption — a Text Moment (no
  // image) must have something to actually show.
  if (!imagePath && !caption?.trim()) {
    return NextResponse.json({ error: 'Add a photo or write something for this moment.' }, { status: 400 })
  }
  const resolvedAudience = audience === 'group' ? 'group' : 'everyone'

  const { data: membership } = await supabase
    .from('trip_members').select('group_id')
    .eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!membership) return NextResponse.json({ error: 'You are not a member of this event.' }, { status: 403 })

  // Side Games proxy entry — same server-side playing-group validation
  // as the Side Games entries route (not trusted from the client), so
  // a Moment posted "of" someone else can only ever be for a genuine
  // same-group teammate, never an arbitrary event player supplied by
  // the client. subjectPlayerId is the achievement/story owner
  // (moments.player_id, unchanged meaning); capturedBy is only ever
  // set when a genuine proxy capture occurred — left null for the
  // overwhelmingly common self-capture case, matching the migration's
  // own "NULL means captured by the subject themselves" convention.
  let subjectPlayerId = user.id
  let capturedBy: string | null = null
  if (requestedPlayerId && requestedPlayerId !== user.id) {
    const { data: nomineeMembership } = await supabase
      .from('trip_members').select('group_id')
      .eq('trip_id', tripId).eq('profile_id', requestedPlayerId).maybeSingle()
    if (nomineeMembership && membership.group_id && nomineeMembership.group_id === membership.group_id) {
      subjectPlayerId = requestedPlayerId
      capturedBy = user.id
    }
    // Falls back silently to self if the nominee isn't valid/same-group
    // — a Moment always has to belong to somebody, and refusing the
    // whole post over an invalid selector would lose a genuine photo
    // over what's ultimately a cosmetic attribution detail.
  }

  const { data: moment, error: momentErr } = await supabase.from('moments').insert({
    trip_id: tripId,
    round_id: roundId ?? null,
    hole_number: holeNumber ?? null,
    player_id: subjectPlayerId,
    captured_by: capturedBy,
    group_id: resolvedAudience === 'group' ? membership.group_id : null,
    caption: caption?.trim() || null,
    image_path: imagePath ?? null,
    audience: resolvedAudience,
  }).select().single()

  if (momentErr) {
    console.error('[moments POST]', {
      code: momentErr.code, message: momentErr.message,
      details: momentErr.details, hint: momentErr.hint, tripId, userId: user.id,
    })
    // TEMPORARY diagnostic detail — same pattern used for the Trip
    // Information save-failure investigation: a compact postgres error
    // code/message returned as a separate `debug` field (not blended
    // into the main error text), so the real failure is visible without
    // needing Vercel log access. Remove once any further issue in this
    // path is confirmed fixed.
    return NextResponse.json({
      error: "Moment couldn't be posted. Please try again.",
      debug: `${momentErr.code ?? 'unknown'}: ${momentErr.message ?? 'no message'}`,
    }, { status: 500 })
  }

  // Link into Chat's existing feed — a 'moment' message_type row pointing
  // at the full record, so Chat needs no second feed or parallel query.
  // If this second insert fails, the Moment itself still exists (visible
  // via My Moments / Event Story) — logged, not silently swallowed, but
  // not rolled back either, since a missing chat entry is a lesser
  // failure than losing the photo itself.
  const chatInsertPayload = {
    trip_id: tripId,
    sender_user_id: user.id,
    message_type: 'moment',
    recipient_type: resolvedAudience === 'group' ? 'group' : 'all',
    recipient_group_id: resolvedAudience === 'group' ? membership.group_id : null,
    message: caption?.trim() || '📷 Moment',
    moment_id: moment.id,
  }
  let { error: msgErr } = await supabase.from('event_messages').insert(chatInsertPayload)
  // Same compatibility fallback as the messages route — if 'all' is
  // rejected by a stale recipient_type constraint, retry with 'event'.
  if (msgErr && msgErr.code === '23514' && chatInsertPayload.recipient_type === 'all') {
    const retry = await supabase.from('event_messages').insert({ ...chatInsertPayload, recipient_type: 'event' })
    msgErr = retry.error
  }
  if (msgErr) {
    console.error('[moments POST] chat-link insert failed (moment itself still saved)', { code: msgErr.code, message: msgErr.message, momentId: moment.id })
  }

  // Sprint 9 Item 4 — link this Moment back onto the Side Competition
  // entry/lead-change it was captured for, so Event Story can later pair
  // the golf fact ("Darren took NTP lead at 0.8m") with the actual photo.
  // Uses the admin client for this specific follow-up write only — the
  // primary moment insert above stays on the regular RLS-scoped client,
  // unchanged. Ownership is re-verified here server-side (never trusts
  // the client-supplied IDs alone) so this can't be used to attach a
  // photo to someone else's competition result. Best-effort: if this
  // fails, the Moment itself is still fully saved — only the Story
  // relationship is missing, logged, not silently swallowed.
  //
  // 30 Aug field-test bundle, P1 — the actual root cause of the
  // reported "photo Moment + separate Announcement, for organiser/
  // proxy submissions." This check used to require
  // entryRes.data.player_id === user.id exactly — the photo uploader
  // had to be the literal claimant. That's narrower than the
  // established authority rule for acting on someone's Side Game
  // claim, which entries/route.ts's own POST (submission) already uses:
  // same-group membership, not exact player identity — an organiser
  // submitting/capturing for a paper player, or any same-group proxy
  // scenario, is already a legitimate, supported action for the claim
  // itself. This linking step was the one place still enforcing a
  // stricter, inconsistent rule, which meant moment_id never got set
  // for exactly those cases — so at verify time, this fix's own
  // earlier work (checking side_comp_entries.moment_id) correctly
  // found nothing to merge into, and silently fell through to the
  // standalone-announcement path, reproducing the "two separate Chat
  // items" bug for every proxy/organiser-submitted claim specifically.
  // Reuses the exact same group-membership check, not a third,
  // independent authority rule.
  //
  // Hoisted above both blocks (entry link + lead-change link below) —
  // both need the same authorization result and the same claimant id,
  // computed once, not two independent lookups that could disagree.
  let claimAuthorized = false
  let claimantPlayerId: string | null = null
  if (sideCompEntryId) {
    const admin = createAdminClient()
    const entryRes = await admin.from('side_comp_entries').select('id, player_id, side_comp_id').eq('id', sideCompEntryId).maybeSingle()
    if (entryRes.data) {
      claimantPlayerId = entryRes.data.player_id
      if (entryRes.data.player_id === user.id) {
        claimAuthorized = true
      } else {
        const compRes = await admin.from('side_comps').select('round_id').eq('id', entryRes.data.side_comp_id).maybeSingle()
        if (compRes.data) {
          const [uploaderMember, claimantMember] = await Promise.all([
            admin.from('trip_members').select('group_id').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle(),
            admin.from('trip_members').select('group_id').eq('trip_id', tripId).eq('profile_id', entryRes.data.player_id).maybeSingle(),
          ])
          const uploaderGroupId = uploaderMember.data?.group_id ?? null
          const claimantGroupId = claimantMember.data?.group_id ?? null
          claimAuthorized = !!uploaderGroupId && uploaderGroupId === claimantGroupId
        }
      }
    }
    if (claimAuthorized) {
      const { error: linkErr } = await admin.from('side_comp_entries').update({ moment_id: moment.id }).eq('id', sideCompEntryId)
      if (linkErr) console.error('[moments POST] side_comp_entries link failed', { code: linkErr.code, message: linkErr.message, momentId: moment.id, sideCompEntryId })
    } else {
      console.warn('[moments POST] sideCompEntryId authorization failed — not linking', { sideCompEntryId, userId: user.id, sideCompId })
    }
  }
  if (leadChangeId) {
    const admin = createAdminClient()
    // 30 Aug field-test bundle, P1 — same root cause as the entry-link
    // fix above, in the same route: this update filtered on
    // `player_id = user.id` (the photo uploader), but
    // side_comp_lead_changes.player_id is the CLAIMANT who took the
    // lead — for a proxy/organiser-submitted claim those are two
    // different people. Supabase doesn't error on a zero-row update, so
    // this failed completely silently: the lead-change row never got
    // its moment_id set, for exactly the same class of case the entry
    // link above was just fixed for. claimAuthorized/claimantPlayerId
    // (computed above) already confirmed the caller has legitimate
    // standing over this specific claimant's entry — this now correctly
    // targets the claimant's own id, not the caller's.
    if (sideCompEntryId && claimAuthorized && claimantPlayerId) {
      const { error: leadLinkErr } = await admin.from('side_comp_lead_changes').update({ moment_id: moment.id }).eq('id', leadChangeId).eq('player_id', claimantPlayerId)
      if (leadLinkErr) console.error('[moments POST] side_comp_lead_changes link failed', { code: leadLinkErr.code, message: leadLinkErr.message, momentId: moment.id, leadChangeId })
    }
  }

  return NextResponse.json({ ok: true, moment })
}
