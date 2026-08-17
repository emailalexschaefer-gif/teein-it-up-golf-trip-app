/**
 * GET /api/trips/[tripId]/rounds/[roundId]/my-starting-hole
 *
 * Shotgun Start — a minimal, auth-scoped read for the scoring shells
 * specifically: resolves the caller's own group server-side and
 * returns just startType + their assigned starting hole (or null if
 * unassigned — the player-side fallback picker handles that case).
 * Deliberately narrow rather than reusing /starting-holes (which
 * returns every group and is organiser-shaped) — this avoids needing
 * to plumb group_id through the scoring shells just to look this up.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  type AdminClient = ReturnType<typeof createAdminClient>
  const admin: AdminClient = createAdminClient()

  const [membershipRes, roundRes] = await Promise.all([
    admin.from('trip_members').select('group_id').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle(),
    admin.from('rounds').select('start_type').eq('id', roundId).eq('trip_id', tripId).maybeSingle(),
  ])
  if (!membershipRes.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })
  if (!roundRes.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })

  const startType = roundRes.data.start_type === 'shotgun' ? 'shotgun' : 'standard'
  const groupId = membershipRes.data.group_id

  if (startType !== 'shotgun' || !groupId) {
    return NextResponse.json({ startType, startingHole: null })
  }

  const holeRes = await admin.from('round_group_starting_holes').select('starting_hole').eq('round_id', roundId).eq('group_id', groupId).maybeSingle()
  return NextResponse.json({ startType, startingHole: holeRes.data?.starting_hole ?? null })
}
