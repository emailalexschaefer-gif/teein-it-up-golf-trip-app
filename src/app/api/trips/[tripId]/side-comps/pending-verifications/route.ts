/**
 * GET /api/trips/[tripId]/side-comps/pending-verifications?roundId=...
 *
 * Every pending Side Game claim where the authenticated user is the
 * snapshotted required_verifier_id — never re-resolved from current
 * marker assignments (required_verifier_id was fixed at claim time, per
 * Stage 1's explicit design: a later marker reassignment must not
 * retroactively change who was responsible for an already-submitted
 * claim). trip-wide by default; ?roundId= narrows to one round (the
 * scoring shell's own use case — a marker only needs to see claims for
 * the round they're actively scoring).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteProps { params: Promise<{ tripId: string }> }

export async function GET(req: NextRequest, { params }: RouteProps) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  type AdminClient = ReturnType<typeof createAdminClient>
  const admin: AdminClient = createAdminClient()

  const memberCheck = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberCheck.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

  const roundId = req.nextUrl.searchParams.get('roundId')

  // side_comps first (scoped to this trip, optionally this round), then
  // entries against those — a flat two-step query, not a nested embed,
  // matching the same lesson already applied elsewhere in this app after
  // the Edit Trip readback bug (a 2+ level nested PostgREST embed
  // through this data shape is exactly the pattern that broke there).
  let compsQuery = admin.from('side_comps').select('id, comp_type, hole_number, round_id').eq('trip_id', tripId).eq('enabled', true)
  if (roundId) compsQuery = compsQuery.eq('round_id', roundId)
  const compsRes = await compsQuery
  const compsById = new Map((compsRes.data ?? []).map(c => [c.id, c]))
  const compIds = [...compsById.keys()]
  if (compIds.length === 0) return NextResponse.json({ pending: [] })

  const entriesRes = await admin
    .from('side_comp_entries')
    .select('id, side_comp_id, player_id, claimed_value, moment_id, created_at, profiles:player_id(full_name)')
    .in('side_comp_id', compIds)
    .eq('verification_status', 'pending')
    .eq('required_verifier_id', user.id)
    .order('created_at', { ascending: true })

  const COMP_LABEL: Record<string, string> = { nearest_pin: 'Nearest the Pin', longest_drive: 'Longest Drive', pros_approach: "Pro's Approach" }

  const pending = await Promise.all(((entriesRes.data ?? []) as unknown as {
    id: string; side_comp_id: string; player_id: string; claimed_value: number | null; moment_id: string | null
    created_at: string; profiles: { full_name: string } | null
  }[]).map(async e => {
    const comp = compsById.get(e.side_comp_id)
    let momentUrl: string | null = null
    if (e.moment_id) {
      const momentRes = await admin.from('moments').select('image_path').eq('id', e.moment_id).maybeSingle()
      if (momentRes.data?.image_path) {
        const signed = await admin.storage.from('event-moments').createSignedUrl(momentRes.data.image_path, 3600)
        momentUrl = signed.data?.signedUrl ?? null
      }
    }
    return {
      entryId: e.id, sideCompId: e.side_comp_id,
      compType: comp?.comp_type ?? null, compLabel: comp ? (COMP_LABEL[comp.comp_type] ?? comp.comp_type) : 'Side Competition',
      holeNumber: comp?.hole_number ?? null,
      playerId: e.player_id, playerName: e.profiles?.full_name ?? 'Player',
      claimedValue: e.claimed_value, momentUrl,
    }
  }))

  return NextResponse.json({ pending })
}
