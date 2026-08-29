import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { orderHolesByPlaySequence } from '@/lib/scoring/holeSequence'

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
    .select('id, hole_number, par, stroke_index, distance, pro_tip')
    .eq('round_id', roundId)
    .order('hole_number', { ascending: true })

  if (hErr) return NextResponse.json({ error: 'Could not load holes.' }, { status: 500 })

  // Starting Tee fix — this used to hand back holes in raw ascending
  // hole_number order unconditionally. That's identical to PLAY order
  // for a 1st-tee round (any hole count) and for a 9-hole/10th-tee
  // round (a contiguous 10-18 run, still ascending) — but for an
  // 18-hole/10th-tee round, play order is 10..18 then 1..9, which
  // ascending hole_number order does not produce. Every downstream
  // consumer (scoring navigation, swipe, completion, the scorecard
  // display) walks this array purely by POSITION, never by hole_number
  // value — confirmed by inspection before this change — so correcting
  // the order here, once, is what makes all of that correct without
  // touching any of it. Only round_id is needed to look up the round's
  // own starting_hole_number; a round with the column absent (shouldn't
  // happen post-migration, but defensive) defaults to 1, preserving
  // today's exact behaviour.
  const roundInfo = await admin.from('rounds').select('holes, starting_hole_number').eq('id', roundId).maybeSingle()
  const holeCount: 9 | 18 = roundInfo.data?.holes === 9 ? 9 : 18
  const startingHoleNumber: 1 | 10 = roundInfo.data?.starting_hole_number === 10 ? 10 : 1
  const orderedHoles = orderHolesByPlaySequence(holes ?? [], holeCount, startingHoleNumber)

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
    holes: orderedHoles,
    sideComps: compsRes.data ?? [],
  })
}
