/**
 * POST /api/trips/[tripId]/messages/[messageId]/pin
 * Body: { pinned: boolean }
 *
 * Organiser-only. Enforces exactly one pinned message per trip in V1 —
 * pinning a new message first unpins whatever was previously pinned
 * (two separate UPDATEs, not a partial unique index, since "replaces
 * the existing pin after a simple confirmation" is a UX-level
 * confirmation the client already handles before calling this; the
 * server's job is just to make the end state correct regardless of
 * what was pinned before). is_pinned already exists on event_messages
 * (migration 025) — no schema change needed for this feature.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteProps { params: Promise<{ tripId: string; messageId: string }> }

export async function POST(req: NextRequest, { params }: RouteProps) {
  const { tripId, messageId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  type AdminClient = ReturnType<typeof createAdminClient>
  const admin: AdminClient = createAdminClient()

  const membership = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!membership.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })
  if (membership.data.role !== 'organiser') {
    return NextResponse.json({ error: 'Only the organiser can pin or unpin messages.' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const pinned = body.pinned === true

  const messageCheck = await admin.from('event_messages').select('id, trip_id').eq('id', messageId).maybeSingle()
  if (!messageCheck.data || messageCheck.data.trip_id !== tripId) {
    return NextResponse.json({ error: 'Message not found.' }, { status: 404 })
  }

  if (pinned) {
    // Unpin whatever else was pinned first — one pinned message per
    // trip, enforced here regardless of what the client already knew
    // about at confirmation time.
    await admin.from('event_messages').update({ is_pinned: false }).eq('trip_id', tripId).eq('is_pinned', true)
  }

  const { error } = await admin.from('event_messages').update({ is_pinned: pinned }).eq('id', messageId)
  if (error) {
    console.error('[messages pin]', { tripId, messageId, error: error.message })
    return NextResponse.json({ error: "Couldn't update the pin. Please try again." }, { status: 500 })
  }

  return NextResponse.json({ ok: true, pinned })
}
