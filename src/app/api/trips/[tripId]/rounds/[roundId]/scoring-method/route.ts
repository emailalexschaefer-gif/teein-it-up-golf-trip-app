/**
 * GET  /api/trips/[tripId]/rounds/[roundId]/scoring-method
 *      -> { methods: { [playerId]: 'digital' | 'paper' } }
 * PATCH /api/trips/[tripId]/rounds/[roundId]/scoring-method
 *      body: { playerId: string, scoringMethod: 'digital' | 'paper' }
 *
 * Offline Player Support, item 4 — "solve the pre-round persistence
 * problem properly... do not invent a fragile client-only state."
 *
 * scorecards rows do not necessarily exist yet at Finalise Round time
 * — they are normally only created when begin_round() runs. This
 * route upserts a minimal scorecards row early (id, round_id,
 * player_id, scoring_method, status — playing_handicap left at its
 * column default until begin_round() sets the real snapshot value)
 * specifically so the organiser's choice has somewhere durable to
 * live before the round goes live. This is the smallest correct write
 * path: it reuses scorecards entirely rather than inventing a second,
 * parallel pre-round player-membership table, and it is exactly what
 * migration 064's begin_round() was already carefully rewritten to
 * preserve — that upsert never touches scoring_method, so a value
 * written here survives begin_round() untouched, and playing_handicap
 * written here is overwritten by begin_round()'s own real snapshot as
 * intended.
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

  const membership = await admin.from('trip_members').select('id').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!membership.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

  const roundCheck = await admin.from('rounds').select('id').eq('id', roundId).eq('trip_id', tripId).maybeSingle()
  if (!roundCheck.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })

  const { data, error } = await admin.from('scorecards').select('player_id, scoring_method').eq('round_id', roundId)
  if (error) {
    console.error('[scoring-method GET]', { code: error.code, message: error.message, tripId, roundId })
    return NextResponse.json({ error: 'Could not load scoring methods.' }, { status: 500 })
  }

  // Absence of a scorecards row for a player is correctly read as
  // 'digital' by the client (the column's own default) — this route
  // only ever returns explicit overrides that already exist, matching
  // "default is digital" exactly without needing a row for every
  // player just to represent the common case.
  const methods: Record<string, 'digital' | 'paper'> = {}
  for (const row of data ?? []) methods[row.player_id] = row.scoring_method as 'digital' | 'paper'

  return NextResponse.json({ methods })
}

export async function PATCH(req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  type AdminClient = ReturnType<typeof createAdminClient>
  const admin: AdminClient = createAdminClient()

  const membership = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!membership.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })
  if (membership.data.role !== 'organiser') {
    return NextResponse.json({ error: 'Only the organiser can set a player\u2019s scoring method.' }, { status: 403 })
  }

  const roundCheck = await admin.from('rounds').select('id, status').eq('id', roundId).eq('trip_id', tripId).maybeSingle()
  if (!roundCheck.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const playerId = typeof body.playerId === 'string' ? body.playerId : null
  const scoringMethod = body.scoringMethod === 'paper' ? 'paper' : body.scoringMethod === 'digital' ? 'digital' : null
  if (!playerId || !scoringMethod) {
    return NextResponse.json({ error: 'playerId and a valid scoringMethod are required.' }, { status: 400 })
  }

  const playerMember = await admin.from('trip_members').select('id').eq('trip_id', tripId).eq('profile_id', playerId).maybeSingle()
  if (!playerMember.data) return NextResponse.json({ error: 'That player is not part of this event.' }, { status: 404 })

  // Preserve playing_handicap if a scorecards row already exists for
  // this player+round (e.g. this round has already begun and the
  // organiser is adjusting scoring method after the fact — item 4's
  // "remain historically correct" still applies even then). A brand
  // new row uses the column's own default (0) as a placeholder;
  // begin_round() overwrites it with the real snapshot when the round
  // actually starts, exactly as it already does for every other
  // player.
  const { error } = await admin.from('scorecards').upsert(
    { round_id: roundId, player_id: playerId, scoring_method: scoringMethod },
    { onConflict: 'round_id,player_id', ignoreDuplicates: false },
  )
  if (error) {
    console.error('[scoring-method PATCH]', { code: error.code, message: error.message, tripId, roundId, playerId })
    return NextResponse.json({ error: "Couldn't save scoring method. Please try again." }, { status: 500 })
  }

  return NextResponse.json({ ok: true, playerId, scoringMethod })
}
