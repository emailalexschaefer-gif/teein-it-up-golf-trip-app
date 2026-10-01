import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'

interface RouteProps { params: Promise<{ tripId: string; momentId: string }> }

const FavouriteSchema = z.object({ favourite: z.boolean() })

/**
 * PATCH /api/trips/[tripId]/memories/[momentId]/favourite
 *
 * Event Memories V1 (10 Sep), Part 6-7. Organiser-only (Part 17 --
 * "favourite/selection mutations verify organiser ownership"), and
 * idempotent by construction: this is a plain boolean UPDATE to
 * moments.is_event_favourite (migration 085) -- setting it to true
 * when it is already true, or false when already false, is a no-op
 * write with no error, satisfying "favourite is idempotent" and
 * "unfavourite works" as the same code path, not two.
 *
 * Cross-trip protection (Part 17): the update is scoped to both
 * momentId AND trip_id = tripId together -- a momentId that belongs to
 * a different trip is never matched, regardless of whether the caller
 * is that other trip's organiser, since the update simply affects
 * zero rows.
 */
export async function PATCH(request: Request, { params }: RouteProps) {
  const { tripId, momentId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }) }
  const parsed = FavouriteSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const tripRes = await admin.from('trips').select('organiser_id').eq('id', tripId).maybeSingle()
  if (!tripRes.data) return NextResponse.json({ error: 'Event not found.' }, { status: 404 })
  if (tripRes.data.organiser_id !== user.id) {
    return NextResponse.json({ error: 'Only the event organiser can select favourites.' }, { status: 403 })
  }

  const updateRes = await admin.from('moments')
    .update({ is_event_favourite: parsed.data.favourite })
    .eq('id', momentId)
    .eq('trip_id', tripId)
    .select('id, is_event_favourite')
    .maybeSingle()

  if (updateRes.error) {
    console.error('[favourite]', updateRes.error.message)
    return NextResponse.json({ error: 'Could not update favourite. Please try again.' }, { status: 500 })
  }
  if (!updateRes.data) {
    return NextResponse.json({ error: 'Moment not found for this event.' }, { status: 404 })
  }

  return NextResponse.json({ momentId: updateRes.data.id, favourite: updateRes.data.is_event_favourite })
}
