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
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteProps { params: Promise<{ tripId: string }> }

interface SupabaseErrorLike { code?: string; message: string; details?: string; hint?: string }

// Never expose raw Supabase/PostgREST error text to the client — it can
// leak schema/infrastructure detail ("Could not find the table... in the
// schema cache") that means nothing useful to a user and everything to
// someone probing the API. Full detail always goes to server logs only.
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

  const { data, error } = await supabase
    .from('event_messages')
    .select(`
      id, message_type, recipient_type, recipient_group_id, recipient_user_id,
      message, is_pinned, created_at,
      sender:sender_user_id ( full_name ),
      recipient_group:recipient_group_id ( name )
    `)
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    logAndMaskError('event-messages GET', error, { tripId, userId: user.id })
    return NextResponse.json({ error: 'Messages are temporarily unavailable.' }, { status: 500 })
  }

  return NextResponse.json({ messages: data ?? [] })
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
    // This is the exact spot that was leaking raw Supabase error text
    // ("Could not send: Could not find the table...") straight to the
    // client. Fixed: full detail goes to logAndMaskError's console.error
    // only; the client only ever sees a generic, safe message.
    logAndMaskError('event-messages POST', error, { tripId, recipientType, recipientGroupId, recipientUserId, senderUserId: user.id })
    return NextResponse.json({ error: 'Notifications are temporarily unavailable. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, sentMessage: data })
}
