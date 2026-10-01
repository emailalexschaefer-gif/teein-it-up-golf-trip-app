import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchEventMemoryData } from '@/lib/trips/eventMemoryData'

interface RouteProps { params: Promise<{ tripId: string }> }

/**
 * GET /api/trips/[tripId]/memory-manifest
 *
 * Event Memories V1 (10 Sep), Part 11 -- the Event Memory Manifest.
 * Extended for V1.1 Phase 2 (11 Sep) -- per-memory sourceType and Side
 * Game context, and a derived chronological round ordinal.
 *
 * REFACTORED this pass: the actual data-fetching (event/rounds/
 * memories/sideGameWinners -- every provenance decision this route
 * used to document inline) now lives in
 * src/lib/trips/eventMemoryData.ts (fetchEventMemoryData), so the new
 * export route (export/route.ts) can read the exact same canonical
 * data without duplicating this query logic -- per the explicit "do
 * not create a second competing source of truth" instruction. This
 * route's own response shape is UNCHANGED -- it returns exactly what
 * fetchEventMemoryData produces, plus the signed URLs this route
 * specifically needs for the gallery grid (the export route does not
 * request them -- see fetchEventMemoryData's own generateSignedUrls
 * option). Confirmed nothing consuming this route (the gallery page)
 * needs any change as a result.
 *
 * Full provenance/architecture reasoning (sourceType model, Side Game
 * reverse-link mechanism, side_comps.name as the authoritative label,
 * deferred champion) is documented in eventMemoryData.ts itself now,
 * not duplicated here.
 */
export async function GET(_req: Request, { params }: RouteProps) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  // Permissions (Part 17) -- trip membership, not organiser-only.
  const memberRes = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberRes.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

  const data = await fetchEventMemoryData(tripId, { generateSignedUrls: true })
  if (!data) return NextResponse.json({ error: 'Event not found.' }, { status: 404 })

  return NextResponse.json(data)
}
