import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'

interface RouteProps { params: Promise<{ tripId: string; momentId: string }> }

// null = "clear the organiser's explicit decision, go back to following
// the automatic suggestion" -- a genuine third state, not a synonym for
// false. See moments.aftershow_included's own column comment (migration
// 095) and resolveAftershowMomentIds (slideshowDeck.ts) for the full
// resolution contract this writes into.
const AftershowSchema = z.object({ included: z.boolean().nullable() })

/**
 * PATCH /api/trips/[tripId]/memories/[momentId]/aftershow
 *
 * V1.18 (10 Oct) -- Package 3/4. Mirrors the existing favourite/blooper
 * toggle routes exactly: organiser-only, idempotent, scoped to both
 * momentId AND trip_id together -- same reasoning, not repeated in
 * full here. The one structural difference: this accepts `null` as a
 * genuinely distinct third value (not just true/false), since
 * resolveAftershowMomentIds treats "no explicit decision yet" as its
 * own state, separate from an explicit exclusion.
 *
 * Deliberately independent of is_event_favourite/is_blooper -- this
 * never reads or writes either of those columns, and a Moment with
 * neither Favourite nor Blooper set can still be explicitly included
 * here (and vice versa), exactly as the brief's own worked example
 * requires.
 */
export async function PATCH(request: Request, { params }: RouteProps) {
  const { tripId, momentId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }) }
  const parsed = AftershowSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const tripRes = await admin.from('trips').select('organiser_id').eq('id', tripId).maybeSingle()
  if (!tripRes.data) return NextResponse.json({ error: 'Event not found.' }, { status: 404 })
  if (tripRes.data.organiser_id !== user.id) {
    return NextResponse.json({ error: 'Only the event organiser can change the Moments & Bloopers selection.' }, { status: 403 })
  }

  const momentRes = await admin.from('moments').select('id, moment_type').eq('id', momentId).eq('trip_id', tripId).maybeSingle()
  if (!momentRes.data) return NextResponse.json({ error: 'Moment not found for this event.' }, { status: 404 })
  if (momentRes.data.moment_type === 'text') {
    return NextResponse.json({ error: 'A text Moment has no visual content for the aftershow.' }, { status: 400 })
  }

  const updateRes = await admin.from('moments')
    .update({ aftershow_included: parsed.data.included })
    .eq('id', momentId)
    .eq('trip_id', tripId)
    .select('id, aftershow_included')
    .maybeSingle()

  if (updateRes.error) {
    console.error('[aftershow]', updateRes.error.message)
    return NextResponse.json({ error: 'Could not update the Moments & Bloopers selection. Please try again.' }, { status: 500 })
  }
  if (!updateRes.data) {
    return NextResponse.json({ error: 'Moment not found for this event.' }, { status: 404 })
  }

  return NextResponse.json({ momentId: updateRes.data.id, aftershowIncluded: updateRes.data.aftershow_included })
}
