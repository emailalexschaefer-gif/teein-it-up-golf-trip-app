import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteProps { params: Promise<{ tripId: string }> }

/**
 * GET /api/trips/[tripId]/memories/count
 *
 * Event Memories V1 follow-up (10 Sep) -- a lightweight count for the
 * My HQ entry-point card ("84 photos ... View all"). Deliberately a
 * separate, narrow route rather than having the card fetch the full
 * memory-manifest: that route batch-generates a signed URL for every
 * Memory (needed for the gallery grid, wasteful for a card that only
 * ever shows a number). This route selects id/round_id only -- no
 * image_path, no Storage call at all.
 *
 * One photo count only, not a separate "photos" vs "Moments" figure --
 * confirmed in the V1 audit that moments is the sole canonical record
 * (one row = one photo = one Moment, no schema concept of multiple
 * photos per Moment) -- a second, different number here would be
 * fabricated, not read from real data.
 */
export async function GET(_req: Request, { params }: RouteProps) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const memberRes = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberRes.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

  const momentsRes = await admin.from('moments').select('id, round_id').eq('trip_id', tripId)
  const moments = (momentsRes.data ?? []) as { id: string; round_id: string | null }[]

  return NextResponse.json({
    photoCount: moments.length,
    roundsWithMemories: new Set(moments.map(m => m.round_id).filter(Boolean)).size,
  })
}
