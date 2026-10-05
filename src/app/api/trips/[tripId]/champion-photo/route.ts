import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'

interface RouteProps { params: Promise<{ tripId: string }> }

const ChampionPhotoSchema = z.object({ momentId: z.string().uuid().nullable() })

/**
 * PATCH /api/trips/[tripId]/champion-photo
 *
 * V1.6 (5 Oct) -- mirrors the Group Photo route (087/group-photo)
 * exactly: organiser-only, server-side revalidated (the selected
 * Moment must genuinely belong to this trip and be a real photo,
 * never trusted from the client), persisted on
 * trips.champion_photo_moment_id (migration 091) rather than
 * session-only.
 *
 * This is the TOP of the champion-photo priority chain described in
 * the brief: an explicit selection here always wins over the
 * automatic Favourite-photo match or the Group Photo fallback, both
 * implemented in slideshowDeck.ts's own champion slide generation.
 */
export async function PATCH(request: Request, { params }: RouteProps) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }) }
  const parsed = ChampionPhotoSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const tripRes = await admin.from('trips').select('organiser_id').eq('id', tripId).maybeSingle()
  if (!tripRes.data) return NextResponse.json({ error: 'Event not found.' }, { status: 404 })
  if (tripRes.data.organiser_id !== user.id) {
    return NextResponse.json({ error: 'Only the event organiser can set the Champion Photo.' }, { status: 403 })
  }

  if (parsed.data.momentId !== null) {
    const momentRes = await admin.from('moments')
      .select('id, moment_type')
      .eq('id', parsed.data.momentId).eq('trip_id', tripId).maybeSingle()
    if (!momentRes.data) return NextResponse.json({ error: 'Moment not found for this event.' }, { status: 404 })
    if (momentRes.data.moment_type !== 'photo') {
      return NextResponse.json({ error: 'The Champion Photo must be a photo, not a video or text Moment.' }, { status: 400 })
    }
  }

  const updateRes = await admin.from('trips')
    .update({ champion_photo_moment_id: parsed.data.momentId })
    .eq('id', tripId)
    .select('champion_photo_moment_id')
    .maybeSingle()

  if (updateRes.error) {
    console.error('[champion-photo]', updateRes.error.message)
    return NextResponse.json({ error: 'Could not update the Champion Photo. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ championPhotoMomentId: updateRes.data?.champion_photo_moment_id ?? null })
}
