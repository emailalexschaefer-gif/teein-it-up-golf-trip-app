/**
 * POST /api/trips/[tripId]/side-comps/[sideCompId]/entries
 *
 * Submits (or corrects) the authenticated player's own result for a Side
 * Competition. Who may submit: the player themselves, always — the
 * `playerId` is never taken from the request body, only from the
 * authenticated session, so there is no path by which one player could
 * submit on another's behalf. Per the explicit V1 decision: no marker
 * submits a side-comp result for someone else, and no organiser
 * correction endpoint exists yet — that's deliberately deferred, not
 * overlooked (see delivery notes).
 *
 * Leadership is decided entirely inside the Postgres RPC functions
 * (migration 038), not here and not by the client — this route's job is
 * strictly to validate the request shape, resolve which RPC applies for
 * this competition's comp_type, call it, and hand back exactly what it
 * returned. It does not itself compare values or infer who's leading.
 *
 * Idempotent by construction: UNIQUE(side_comp_id, player_id) on
 * side_comp_entries means a resubmission (refresh-and-retry, or a
 * genuine correction) is always an UPDATE of the same row inside the
 * RPC, never a second row — and the RPC only appends to the leadership
 * history when the authoritative comparison actually changes the leader,
 * so resubmitting an unchanged result is a true no-op there too.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteProps { params: Promise<{ tripId: string; sideCompId: string }> }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId, sideCompId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  type AdminClient = ReturnType<typeof createAdminClient>
  const admin: AdminClient = createAdminClient()

  const memberCheck = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberCheck.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

  const compRes = await admin.from('side_comps').select('id, comp_type, trip_id').eq('id', sideCompId).maybeSingle()
  if (!compRes.data || compRes.data.trip_id !== tripId) {
    return NextResponse.json({ error: 'Side competition not found.' }, { status: 404 })
  }

  // The caller's own existing entry (so re-visiting the hole shows what
  // they already answered, and a resubmission is understood as a
  // correction rather than a fresh attempt) — read-only here, the RPCs
  // above are the only write path.
  const myEntryRes = await admin.from('side_comp_entries')
    .select('id, qualified, result_value')
    .eq('side_comp_id', sideCompId).eq('player_id', user.id).maybeSingle()

  // Current leader — same derivation as each RPC's own final SELECT
  // (value-based for NTP/Pro's Approach, log-walk for Longest Drive),
  // duplicated here only because this is a read that doesn't need the
  // row-lock a write does — reusing the RPCs themselves for reads would
  // needlessly lock the competition just to display current state.
  let currentLeader: { playerId: string; playerName: string; resultValue: number | null } | null = null
  if (compRes.data.comp_type === 'longest_drive') {
    // Walk the append-only log from most recent, verified against each
    // candidate's CURRENT qualified flag — a plain sequential lookup
    // rather than an embedded-join filter, since PostgREST's exact
    // behaviour for filtering a nested resource inside an outer select
    // isn't something this sandbox can verify by actually running it.
    // At most a handful of lead-change rows per competition in practice,
    // so this is cheap.
    const { data: changes } = await admin
      .from('side_comp_lead_changes')
      .select('player_id, sequence_number')
      .eq('side_comp_id', sideCompId)
      .order('sequence_number', { ascending: false })
    for (const change of (changes ?? []) as { player_id: string }[]) {
      const { data: entry } = await admin
        .from('side_comp_entries').select('qualified')
        .eq('side_comp_id', sideCompId).eq('player_id', change.player_id).maybeSingle()
      if (entry?.qualified) {
        const { data: profile } = await admin.from('profiles').select('full_name').eq('id', change.player_id).maybeSingle()
        currentLeader = { playerId: change.player_id, playerName: profile?.full_name ?? 'Player', resultValue: null }
        break
      }
    }
  } else {
    const { data } = await admin
      .from('side_comp_entries')
      .select('player_id, result_value, profiles:player_id(full_name)')
      .eq('side_comp_id', sideCompId).eq('qualified', true)
      .order('result_value', { ascending: true })
      .limit(1)
    const row = (data ?? [])[0] as unknown as { player_id: string; result_value: number; profiles: { full_name: string } | null } | undefined
    if (row) currentLeader = { playerId: row.player_id, playerName: row.profiles?.full_name ?? 'Player', resultValue: row.result_value }
  }

  return NextResponse.json({
    myEntry: myEntryRes.data ? { qualified: myEntryRes.data.qualified, resultValue: myEntryRes.data.result_value } : null,
    currentLeader,
  })
}

export async function POST(req: NextRequest, { params }: RouteProps) {
  const { tripId, sideCompId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  type AdminClient = ReturnType<typeof createAdminClient>
  const admin: AdminClient = createAdminClient()

  const memberCheck = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberCheck.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

  const compRes = await admin.from('side_comps').select('id, comp_type, trip_id, enabled').eq('id', sideCompId).maybeSingle()
  if (!compRes.data || compRes.data.trip_id !== tripId) {
    return NextResponse.json({ error: 'Side competition not found.' }, { status: 404 })
  }
  if (!compRes.data.enabled) {
    return NextResponse.json({ error: 'This competition is not active.' }, { status: 409 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const qualified = body.qualified === true

  if (compRes.data.comp_type === 'nearest_pin' || compRes.data.comp_type === 'pros_approach') {
    const resultValue = typeof body.resultValue === 'number' ? body.resultValue : null
    if (qualified && (resultValue === null || !Number.isFinite(resultValue) || resultValue <= 0)) {
      return NextResponse.json({ error: 'Enter a valid distance from the pin.' }, { status: 400 })
    }
    const { data, error } = await admin.rpc('submit_side_comp_value_entry', {
      p_side_comp_id: sideCompId, p_player_id: user.id,
      p_qualified: qualified, p_result_value: qualified ? resultValue : null,
      p_entered_by: user.id,
    })
    if (error) {
      console.error('[side-comp entries] submit_side_comp_value_entry failed', { sideCompId, error: error.message })
      return NextResponse.json({ error: error.message.includes('not currently active') ? 'This round is not currently active.' : "Couldn't save your result. Please try again." }, { status: error.message.includes('not currently active') ? 409 : 500 })
    }
    const row = data?.[0]
    return NextResponse.json({
      entryId: row?.entry_id ?? null,
      becameLeader: row?.became_leader ?? false,
      currentLeader: row?.current_leader_player_id ? { playerId: row.current_leader_player_id, playerName: row.current_leader_name, resultValue: row.current_leader_value } : null,
      leadChangeId: row?.lead_change_id ?? null,
    })
  }

  if (compRes.data.comp_type === 'longest_drive') {
    const claimsBeatLead = body.claimsBeatLeader === true
    const { data, error } = await admin.rpc('submit_longest_drive_entry', {
      p_side_comp_id: sideCompId, p_player_id: user.id,
      p_qualified: qualified, p_claims_beat_lead: claimsBeatLead,
      p_entered_by: user.id,
    })
    if (error) {
      console.error('[side-comp entries] submit_longest_drive_entry failed', { sideCompId, error: error.message })
      return NextResponse.json({ error: error.message.includes('not currently active') ? 'This round is not currently active.' : "Couldn't save your result. Please try again." }, { status: error.message.includes('not currently active') ? 409 : 500 })
    }
    const row = data?.[0]
    return NextResponse.json({
      entryId: row?.entry_id ?? null,
      becameLeader: row?.became_leader ?? false,
      currentLeader: row?.current_leader_player_id ? { playerId: row.current_leader_player_id, playerName: row.current_leader_name, resultValue: null } : null,
      leadChangeId: row?.lead_change_id ?? null,
    })
  }

  return NextResponse.json({ error: 'Unsupported competition type.' }, { status: 400 })
}
