/**
 * GET  /api/trips/[tripId]/rounds/[roundId]/playing-partner
 * POST /api/trips/[tripId]/rounds/[roundId]/playing-partner
 * POST body: { partnerId: string }
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
 * organiser to intervene — the active reassignment workflow this once
 * referred to has since been removed from normal navigation
 * (Deployment A: organiser involvement is now group creation plus
 * passive visibility only, per PlayingPartnerStatus.tsx).
 *
 * GET returns the caller's own status (already paired, or not) plus
 * the list of eligible candidates — other group-mates who also don't
 * yet have a marker assigned for this round. A solo group, or a group
 * where everyone else is already paired, correctly returns an empty
 * candidate list rather than an error — the UI treats that as "nothing
 * to choose", not a failure.
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

  const memberCheck = await admin.from('trip_members').select('group_id').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberCheck.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

  const myMarkerRes = await admin.from('round_markers').select('marker_player_id').eq('round_id', roundId).eq('player_id', user.id).maybeSingle()
  if (myMarkerRes.data) {
    const partnerProfile = await admin.from('profiles').select('full_name').eq('id', myMarkerRes.data.marker_player_id).maybeSingle()
    return NextResponse.json({ paired: true, partnerId: myMarkerRes.data.marker_player_id, partnerName: partnerProfile.data?.full_name ?? null, candidates: [] })
  }

  if (!memberCheck.data.group_id) return NextResponse.json({ paired: false, partnerId: null, partnerName: null, candidates: [] })

  // Group-mates who play this round (have a scorecard) and don't
  // already have a marker of their own — a candidate who's already
  // paired with someone else is correctly excluded, not offered.
  const [groupMembersRes, cardsRes, existingMarkersRes] = await Promise.all([
    admin.from('trip_members').select('profile_id, profiles ( full_name )').eq('trip_id', tripId).eq('group_id', memberCheck.data.group_id),
    // Field-Test Fix Package, item 2 — scoring_method now selected.
    // This is a genuinely separate endpoint from /markers (that one
    // covers auto-paired 2-player groups; this one covers user-chosen
    // pairing for groups larger than two), with its own independent
    // copy of this exact candidate-filtering logic — the /markers fix
    // from an earlier pass never touched this code path at all, which
    // is exactly why a paper player still appeared here despite that
    // fix. Same exclusion, applied here too.
    admin.from('scorecards').select('player_id, scoring_method').eq('round_id', roundId).neq('status', 'withdrawn'),
    admin.from('round_markers').select('player_id').eq('round_id', roundId),
  ])
  const cardPlayerIds = new Set(
    (cardsRes.data ?? [])
      .filter((c: { scoring_method?: string }) => c.scoring_method !== 'paper')
      .map((c: { player_id: string }) => c.player_id)
  )
  const alreadyPaired = new Set((existingMarkersRes.data ?? []).map((m: { player_id: string }) => m.player_id))

  const candidates = ((groupMembersRes.data ?? []) as unknown as { profile_id: string; profiles: { full_name: string } | null }[])
    .filter(m => m.profile_id !== user.id && cardPlayerIds.has(m.profile_id) && !alreadyPaired.has(m.profile_id))
    .map(m => ({ id: m.profile_id, name: m.profiles?.full_name ?? 'Player' }))

  return NextResponse.json({ paired: false, partnerId: null, partnerName: null, candidates })
}

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

  // Field-Test Fix Package, item 2 — server-side enforcement, not just
  // the GET candidate list. Without this, a paper player could still
  // be paired via a direct POST even after the UI correctly stopped
  // offering them.
  const partnerCard = await admin.from('scorecards').select('scoring_method').eq('round_id', roundId).eq('player_id', partnerId).maybeSingle()
  if (partnerCard.data?.scoring_method === 'paper') {
    return NextResponse.json({ error: 'This player is using a paper scorecard this round and does not need a digital Playing Partner.' }, { status: 400 })
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
