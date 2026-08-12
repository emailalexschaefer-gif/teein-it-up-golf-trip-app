import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params

  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  // Verify membership
  const m = await admin.from('trip_members').select('id').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!m.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

  const { data: holes, error: hErr } = await admin
    .from('holes')
    .select('id, hole_number, par, stroke_index')
    .eq('round_id', roundId)
    .order('hole_number', { ascending: true })

  if (hErr) return NextResponse.json({ error: 'Could not load holes.' }, { status: 500 })

  // Sprint 9 — Side Competitions + Powerplay. Fetched alongside holes
  // since both are needed together to render hole-navigator badges and
  // on-hole banners, and this route is already the one place the
  // scoring shell loads round-scoped hole data from. Corrected model:
  // Powerplay is just another side_comps row (comp_type = 'powerplay'),
  // not a separate rounds column — this single query already returns
  // every competition instance, including however many Powerplay holes
  // are configured, with no special-casing needed here at all.
  const compsRes = await admin.from('side_comps').select('id, comp_type, hole_number, enabled').eq('round_id', roundId).eq('enabled', true)

  return NextResponse.json({
    holes: holes ?? [],
    sideComps: compsRes.data ?? [],
  })
}
