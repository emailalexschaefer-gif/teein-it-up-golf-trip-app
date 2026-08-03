/**
 * GET  /api/trips/[tripId]/messages — list messages visible to the caller
 * POST /api/trips/[tripId]/messages — send an announcement or targeted
 *      notification (organiser only)
 *
 * Deliberately uses the REGULAR (non-admin) Supabase client for both
 * operations — RLS on event_messages is exactly what should determine
 * who can read/write here, so this is the one place in the codebase where
 * NOT bypassing RLS with the admin client is the correct choice, not an
 * oversight.
 *
 * GET does NOT use embedded PostgREST relationship syntax (e.g.
 * `sender:sender_user_id ( full_name )`). event_messages has TWO separate
 * foreign keys into profiles (sender_user_id AND recipient_user_id) —
 * exactly the ambiguous-relationship scenario PostgREST can fail to
 * resolve, even when the embed syntax explicitly names the column. This
 * is the same class of bug already found and fixed twice elsewhere in
 * this project (the trip detail page's scorecards query, and the
 * tournament route's scorecards query) — split into separate queries,
 * merged in application code, rather than relying on PostgREST embed
 * inference a third time.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteProps { params: Promise<{ tripId: string }> }

interface SupabaseErrorLike { code?: string; message: string; details?: string; hint?: string }

// Never expose raw Supabase/PostgREST error text to the client — it can
// leak schema/infrastructure detail that means nothing useful to a user
// and everything to someone probing the API. Full detail always goes to
// server logs only.
function logAndMaskError(context: string, error: SupabaseErrorLike, extra?: Record<string, unknown>) {
  console.error(`[${context}]`, {
    code: error.code, message: error.message, details: error.details, hint: error.hint, ...extra,
  })
  if (error.code === 'PGRST205') {
    console.error(`[${context}] event_messages table is missing or not visible to PostgREST. Check production migration and schema cache — see supabase/event_messages_deploy.sql.`)
  }
  if (error.code === '23514') {
    console.error(`[${context}] CHECK constraint violation. If this is on recipient_type for an 'all' send: an earlier draft of guidance for this table used 'event' as a recipient_type value instead of 'all' — if that version was ever run against this database before the corrected script, the live constraint may still say CHECK (recipient_type IN ('event','group','player')), which would reject 'all' while still accepting 'group' (exactly: group chat works, event-wide announcements don't). Re-run supabase/event_messages_deploy.sql, which DROPs and re-ADDs this constraint with the correct 'all' value — re-running is safe even if you believe it already ran once.`)
  }
}

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  // Step 1 — base columns only, no embedded relationships. RLS alone
  // determines which rows come back (event-wide, own group, personal, or
  // sent-by-me) — nothing here depends on PostgREST resolving a
  // relationship, ambiguous or not.
  const { data: messages, error } = await supabase
    .from('event_messages')
    .select('id, trip_id, sender_user_id, message_type, recipient_type, recipient_group_id, recipient_user_id, message, is_pinned, created_at, moment_id')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    logAndMaskError('event-messages GET', error, { tripId, userId: user.id })
    return NextResponse.json({ error: 'Messages are temporarily unavailable.' }, { status: 500 })
  }

  // Zero rows is a completely normal, successful result — never an error.
  if (!messages || messages.length === 0) {
    return NextResponse.json({ messages: [] })
  }

  // Step 2 — enrich with sender name, group name, and (for Sprint 6
  // Moments) the linked moment's image + hole number, all via separate,
  // unambiguous queries merged in application code — same reasoning as
  // before: event_messages has multiple FKs into profiles, so an
  // embedded PostgREST relationship here carries the same ambiguity risk
  // already root-caused once.
  const senderIds = [...new Set(messages.map(m => m.sender_user_id).filter(Boolean))]
  const groupIds = [...new Set(messages.map(m => m.recipient_group_id).filter((id): id is string => !!id))]
  const momentIds = [...new Set(messages.map(m => m.moment_id).filter((id): id is string => !!id))]

  const [profilesRes, groupsRes, momentsRes, roleRes] = await Promise.all([
    senderIds.length > 0
      ? supabase.from('profiles').select('id, full_name').in('id', senderIds)
      : Promise.resolve({ data: [], error: null }),
    groupIds.length > 0
      ? supabase.from('trip_groups').select('id, name').in('id', groupIds)
      : Promise.resolve({ data: [], error: null }),
    momentIds.length > 0
      ? supabase.from('moments').select('id, image_path, hole_number, caption').in('id', momentIds)
      : Promise.resolve({ data: [], error: null }),
    // Real role, looked up from actual trip membership — never inferred
    // from message_type. 'announcement' meaning "sent through the
    // organiser-only path" is not the same claim as "this person is the
    // organiser," even though in practice the two coincide today (only
    // organisers can send that type) — showing the real, looked-up role
    // keeps that distinction honest rather than collapsing into a guess.
    senderIds.length > 0
      ? supabase.from('trip_members').select('profile_id, role').eq('trip_id', tripId).in('profile_id', senderIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  const nameBySenderId = new Map<string, string>((profilesRes.data ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]))
  const nameByGroupId = new Map<string, string>((groupsRes.data ?? []).map((g: { id: string; name: string }) => [g.id, g.name]))
  const roleBySenderId = new Map<string, string>((roleRes.data ?? []).map((rm: { profile_id: string; role: string }) => [rm.profile_id, rm.role]))
  const momentById = new Map<string, { image_path: string; hole_number: number | null; caption: string | null }>(
    (momentsRes.data ?? []).map((mo: { id: string; image_path: string; hole_number: number | null; caption: string | null }) => [mo.id, mo])
  )

  // Signed URLs for any moment images — the bucket is private (trip-
  // scoped, not public), so a plain public URL wouldn't work.
  const signedUrlById = new Map<string, string | null>()
  await Promise.all([...momentById.entries()].map(async ([id, mo]) => {
    const { data: signed } = await supabase.storage.from('event-moments').createSignedUrl(mo.image_path, 3600)
    signedUrlById.set(id, signed?.signedUrl ?? null)
  }))

  const enriched = messages.map(m => {
    const moment = m.moment_id ? momentById.get(m.moment_id) : null
    return {
      ...m,
      // Honest fallback — 'Member' means "we couldn't resolve this name,"
      // never a claim about who sent it. The previous fallback was
      // literally the word 'Organiser', which read as determined identity
      // rather than what it actually was: a failed lookup. That's the
      // exact bug behind messages showing "— Organiser" regardless of
      // who really sent them.
      sender: { full_name: nameBySenderId.get(m.sender_user_id) ?? 'Member', role: roleBySenderId.get(m.sender_user_id) ?? null },
      recipient_group: m.recipient_group_id ? { name: nameByGroupId.get(m.recipient_group_id) ?? 'Group' } : null,
      momentImageUrl: moment ? signedUrlById.get(m.moment_id!) ?? null : null,
      momentHoleNumber: moment?.hole_number ?? null,
    }
  })

  return NextResponse.json({ messages: enriched })
}

export async function POST(req: NextRequest, { params }: RouteProps) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { recipientType, recipientGroupId, recipientUserId, message, messageType } = body as {
    recipientType?: string; recipientGroupId?: string; recipientUserId?: string; message?: string; messageType?: string
  }

  if (!message || !message.trim()) {
    return NextResponse.json({ error: 'Message cannot be empty.' }, { status: 400 })
  }
  if (!['all', 'group', 'player'].includes(recipientType ?? '')) {
    return NextResponse.json({ error: 'Invalid recipient type.' }, { status: 400 })
  }

  const isChat = messageType === 'chat_message'
  const resolvedType = messageType ?? (recipientType === 'all' ? 'announcement' : recipientType === 'group' ? 'group_notification' : 'player_notification')

  const { data: membership } = await supabase
    .from('trip_members').select('role, group_id')
    .eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()

  // Step-by-step trace for the organiser announcement/notification path —
  // added per explicit request to trace button → API → database rather
  // than re-assert a theory. Logs the actual membership check result and
  // the exact insert payload before the insert happens, so if this fails
  // again, the logs show unambiguously whether it got past the permission
  // check and what payload was actually sent to the database.
  if (!isChat) {
    console.log('[event-messages POST] organiser-path trace', {
      tripId, userId: user.id, resolvedType, recipientType,
      membershipFound: !!membership, membershipRole: membership?.role ?? null,
    })
  }

  if (isChat) {
    // Ordinary participant chat — differentiated from organiser
    // announcements/notifications per the explicit message-model
    // requirement. Any confirmed trip member may send, but only to their
    // own group (server-side check here, in addition to RLS, so a wrong
    // attempt gets a clear reason rather than a bare denial). No "event-
    // wide" option for participants yet — there's no per-trip setting to
    // enable that, so only 'group' is accepted from chat sends.
    if (!membership) return NextResponse.json({ error: 'You are not a member of this event.' }, { status: 403 })
    if (recipientType !== 'group') {
      return NextResponse.json({ error: 'Chat messages can only be sent to your group right now.' }, { status: 400 })
    }
    if (!membership.group_id || membership.group_id !== recipientGroupId) {
      return NextResponse.json({ error: 'You can only message your own group.' }, { status: 403 })
    }
  } else {
    // Announcements and targeted organiser notifications — unchanged
    // behavior from before this pass, organiser-only.
    if (membership?.role !== 'organiser') {
      console.log('[event-messages POST] organiser-path trace: REJECTED at permission check', { tripId, userId: user.id, membershipRole: membership?.role ?? null })
      return NextResponse.json({ error: 'Only the organiser can send announcements or notifications.' }, { status: 403 })
    }
  }

  const insertPayload = {
    trip_id: tripId,
    sender_user_id: user.id,
    message_type: resolvedType,
    recipient_type: recipientType,
    recipient_group_id: recipientType === 'group' ? recipientGroupId : null,
    recipient_user_id: recipientType === 'player' ? recipientUserId : null,
    message: message.trim(),
  }
  if (!isChat) {
    console.log('[event-messages POST] organiser-path trace: passed permission check, inserting', { insertPayload })
  }

  const { data, error } = await supabase.from('event_messages').insert(insertPayload).select().single()

  if (!isChat) {
    console.log('[event-messages POST] organiser-path trace: insert result', {
      succeeded: !error, insertedId: data?.id ?? null,
      errorCode: error?.code ?? null, errorMessage: error?.message ?? null,
    })
  }

  if (error) {
    logAndMaskError('event-messages POST', error, {
      tripId, recipientType, recipientGroupId, recipientUserId, senderUserId: user.id, messageType: resolvedType,
      messageLength: message.trim().length,
      messagePreview: message.trim().slice(0, 40),
    })
    // Reserve "notification" wording for actual organiser notifications —
    // an ordinary chat failure should never say "notification."
    return NextResponse.json(
      { error: isChat ? "Message couldn't be sent. Please try again." : 'Notifications are temporarily unavailable. Please try again.' },
      { status: 500 },
    )
  }

  console.log('event message inserted', {
    id: data.id, tripId: data.trip_id, recipientType: data.recipient_type, recipientGroupId: data.recipient_group_id, messageType: data.message_type,
  })

  return NextResponse.json({ ok: true, sentMessage: data })
}
