import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'

interface RouteProps { params: Promise<{ tripId: string }> }

const GroupPhotoSchema = z.object({ momentId: z.string().uuid().nullable() })

/**
 * PATCH /api/trips/[tripId]/group-photo
 *
 * Event Memories V1.4 completion patch (14 Sep) -- sets or clears
 * (momentId: null) the organiser's Group Photo selection, feeding the
 * already-built groupPhotoMomentId deck capability. Organiser-only
 * (the brief's own explicit instruction -- this is a curation action,
 * matching how Favourite/export are organiser-only elsewhere), and
 * persisted on trips.group_photo_moment_id (migration 087) rather
 * than a session-only choice, so it survives between visits the same
 * way Favourites already do.
 *
 * Validated server-side, not trusted from the client: the selected
 * moment must genuinely belong to this trip and be a real photo
 * Moment (moment_type = 'photo') -- a video/text Moment, or a
 * momentId from a different trip entirely, is rejected outright
 * rather than silently accepted and only failing later in the
 * slideshow.
 */
export async function PATCH(request: Request, { params }: RouteProps) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }) }
  const parsed = GroupPhotoSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const tripRes = await admin.from('trips').select('organiser_id').eq('id', tripId).maybeSingle()
  if (!tripRes.data) return NextResponse.json({ error: 'Event not found.' }, { status: 404 })
  if (tripRes.data.organiser_id !== user.id) {
    return NextResponse.json({ error: 'Only the event organiser can set the Group Photo.' }, { status: 403 })
  }

  if (parsed.data.momentId !== null) {
    const momentRes = await admin.from('moments')
      .select('id, moment_type')
      .eq('id', parsed.data.momentId).eq('trip_id', tripId).maybeSingle()
    if (!momentRes.data) return NextResponse.json({ error: 'Moment not found for this event.' }, { status: 404 })
    if (momentRes.data.moment_type !== 'photo') {
      return NextResponse.json({ error: 'The Group Photo must be a photo, not a video or text Moment.' }, { status: 400 })
    }
  }

  const updateRes = await admin.from('trips')
    .update({ group_photo_moment_id: parsed.data.momentId })
    .eq('id', tripId)
    .select('group_photo_moment_id')
    .maybeSingle()

  if (updateRes.error) {
    console.error('[group-photo]', updateRes.error.message)
    return NextResponse.json({ error: 'Could not update the Group Photo. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ groupPhotoMomentId: updateRes.data?.group_photo_moment_id ?? null })
}
