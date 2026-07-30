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
    .select('id, trip_id, sender_user_id, message_type, recipient_type, recipient_group_id, recipient_user_id, message, is_pinned, created_at')
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

  // Step 2 — enrich with sender name and group name via separate,
  // unambiguous queries, merged in application code.
  const senderIds = [...new Set(messages.map(m => m.sender_user_id).filter(Boolean))]
  const groupIds = [...new Set(messages.map(m => m.recipient_group_id).filter((id): id is string => !!id))]

  const [profilesRes, groupsRes] = await Promise.all([
    senderIds.length > 0
      ? supabase.from('profiles').select('id, full_name').in('id', senderIds)
      : Promise.resolve({ data: [], error: null }),
    groupIds.length > 0
      ? supabase.from('trip_groups').select('id, name').in('id', groupIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  const nameBySenderId = new Map<string, string>((profilesRes.data ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]))
  const nameByGroupId = new Map<string, string>((groupsRes.data ?? []).map((g: { id: string; name: string }) => [g.id, g.name]))

  const enriched = messages.map(m => ({
    ...m,
    sender: { full_name: nameBySenderId.get(m.sender_user_id) ?? 'Organiser' },
    recipient_group: m.recipient_group_id ? { name: nameByGroupId.get(m.recipient_group_id) ?? 'Group' } : null,
  }))

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
  const resolvedType = messageType ?? (recipientType === 'all' ? 'announcement' : recipientType === 'group' ? 'group_notification' : 'player_notification')

  // Server-side organiser check — RLS enforces this too, but checking here
  // first lets us return a clear error message instead of a bare RLS denial.
  const { data: membership } = await supabase
    .from('trip_members').select('role')
    .eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (membership?.role !== 'organiser') {
    return NextResponse.json({ error: 'Only the organiser can send announcements or notifications.' }, { status: 403 })
  }

  const { data, error } = await supabase.from('event_messages').insert({
    trip_id: tripId,
    sender_user_id: user.id,
    message_type: resolvedType,
    recipient_type: recipientType,
    recipient_group_id: recipientType === 'group' ? recipientGroupId : null,
    recipient_user_id: recipientType === 'player' ? recipientUserId : null,
    message: message.trim(),
  }).select().single()

  if (error) {
    logAndMaskError('event-messages POST', error, { tripId, recipientType, recipientGroupId, recipientUserId, senderUserId: user.id })
    return NextResponse.json({ error: 'Notifications are temporarily unavailable. Please try again.' }, { status: 500 })
  }

  console.log('event message inserted', {
    id: data.id, tripId: data.trip_id, recipientType: data.recipient_type, recipientGroupId: data.recipient_group_id,
  })

  return NextResponse.json({ ok: true, sentMessage: data })
}
