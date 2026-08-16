/**
 * POST /api/trips/[tripId]/rounds/[roundId]/playing-partner
 * Body: { partnerId: string }
 *
 * Priority 3 — Playing Partner selection, for groups larger than two
 * (a group of exactly two is still auto-paired at Begin Round, per
 * "auto-select each other and skip unnecessary choice" — this endpoint
 * is never reached for that case). Creates a mutual round_markers pair
 * — both (me -> partner) and (partner -> me) — using the exact same
 * table and reciprocal semantics generateMarkerAssignments already
 * produces for auto-paired groups, not a second mechanism.
 *
 * Both players must be in the same group for this round, and neither
 * may already have a round_markers row for this round — a player who
 * already has a partner (whether auto-assigned or previously chosen)
 * cannot silently overwrite it by calling this again; they'd need an
 * organiser to intervene, matching how marker reassignment already
 * works elsewhere in this app.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

export async function POST(req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  type AdminClient = ReturnType<typeof createAdminClient>
  const admin: AdminClient = createAdminClient()

  const memberCheck = await admin.from('trip_members').select('group_id').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberCheck.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const partnerId = body.partnerId
  if (typeof partnerId !== 'string' || partnerId === user.id) {
    return NextResponse.json({ error: 'Choose a different player as your Playing Partner.' }, { status: 400 })
  }

  const partnerCheck = await admin.from('trip_members').select('group_id').eq('trip_id', tripId).eq('profile_id', partnerId).maybeSingle()
  if (!partnerCheck.data || partnerCheck.data.group_id !== memberCheck.data.group_id || memberCheck.data.group_id === null) {
    return NextResponse.json({ error: 'Your Playing Partner must be in the same group.' }, { status: 400 })
  }

  const existing = await admin.from('round_markers').select('player_id').eq('round_id', roundId).in('player_id', [user.id, partnerId])
  if ((existing.data ?? []).length > 0) {
    return NextResponse.json({ error: 'A Playing Partner has already been assigned for this round.' }, { status: 409 })
  }

  const { error } = await admin.from('round_markers').insert([
    { round_id: roundId, player_id: user.id, marker_player_id: partnerId },
    { round_id: roundId, player_id: partnerId, marker_player_id: user.id },
  ])
  if (error) {
    console.error('[playing-partner] insert failed', { roundId, userId: user.id, partnerId, error: error.message })
    return NextResponse.json({ error: "Couldn't set your Playing Partner. Please try again." }, { status: 500 })
  }

  return NextResponse.json({ ok: true, partnerId })
}
