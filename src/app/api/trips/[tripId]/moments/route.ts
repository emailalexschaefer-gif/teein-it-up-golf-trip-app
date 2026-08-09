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
  const { imagePath, caption, roundId, holeNumber, audience } = body as {
    imagePath?: string; caption?: string; roundId?: string | null; holeNumber?: number | null; audience?: string
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

  const { data: moment, error: momentErr } = await supabase.from('moments').insert({
    trip_id: tripId,
    round_id: roundId ?? null,
    hole_number: holeNumber ?? null,
    player_id: user.id,
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

  return NextResponse.json({ ok: true, moment })
}
