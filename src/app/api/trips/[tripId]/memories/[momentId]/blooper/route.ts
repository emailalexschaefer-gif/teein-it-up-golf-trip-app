import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'

interface RouteProps { params: Promise<{ tripId: string; momentId: string }> }

const BlooperSchema = z.object({ blooper: z.boolean() })

/**
 * PATCH /api/trips/[tripId]/memories/[momentId]/blooper
 *
 * Event Memories V1.4 completion patch (14 Sep). Mirrors the existing
 * favourite toggle route exactly (organiser-only, idempotent, scoped
 * to both momentId AND trip_id together) -- same reasoning, not
 * repeated in full here. The one addition: this Moment must genuinely
 * be a video (moment_type = 'video') before the toggle is attempted at
 * all, so a clear, specific error is returned for a photo/text Moment
 * rather than a opaque database constraint violation. Migration 088's
 * own CHECK constraint (is_blooper = false OR moment_type = 'video')
 * is the authoritative backstop regardless -- this check here is for a
 * better error message, not the actual safety guarantee, which the
 * database itself already provides.
 *
 * Deliberately does NOT require the Moment to also be a Favourite --
 * Bloopers and Favourites are independent selections, exactly as
 * decided when slideshowDeck.ts's own Bloopers logic was built.
 */
export async function PATCH(request: Request, { params }: RouteProps) {
  const { tripId, momentId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }) }
  const parsed = BlooperSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const tripRes = await admin.from('trips').select('organiser_id').eq('id', tripId).maybeSingle()
  if (!tripRes.data) return NextResponse.json({ error: 'Event not found.' }, { status: 404 })
  if (tripRes.data.organiser_id !== user.id) {
    return NextResponse.json({ error: 'Only the event organiser can select Bloopers.' }, { status: 403 })
  }

  const momentRes = await admin.from('moments').select('id, moment_type').eq('id', momentId).eq('trip_id', tripId).maybeSingle()
  if (!momentRes.data) return NextResponse.json({ error: 'Moment not found for this event.' }, { status: 404 })
  if (momentRes.data.moment_type !== 'video') {
    return NextResponse.json({ error: 'Only a video Moment can be selected as a Blooper.' }, { status: 400 })
  }

  const updateRes = await admin.from('moments')
    .update({ is_blooper: parsed.data.blooper })
    .eq('id', momentId)
    .eq('trip_id', tripId)
    .select('id, is_blooper')
    .maybeSingle()

  if (updateRes.error) {
    console.error('[blooper]', updateRes.error.message)
    return NextResponse.json({ error: 'Could not update Blooper selection. Please try again.' }, { status: 500 })
  }
  if (!updateRes.data) {
    return NextResponse.json({ error: 'Moment not found for this event.' }, { status: 404 })
  }

  return NextResponse.json({ momentId: updateRes.data.id, blooper: updateRes.data.is_blooper })
}
