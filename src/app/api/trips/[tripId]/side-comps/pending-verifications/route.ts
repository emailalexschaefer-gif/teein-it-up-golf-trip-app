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
 *
 * P0 fix — shared-device widening. A paper player (Marnie) has no
 * account of her own, so `required_verifier_id = Marnie` can never equal
 * `user.id` for any real session — this hard filter meant her required
 * verifications never surfaced to anyone at all. When ?roundId= is
 * given (the scoring shell's own call), also include claims whose
 * required_verifier_id is the caller's shared-device paper partner for
 * that round, flagged `verifyingAsPartner: true` so the client can show
 * the explicit "Marnie to verify" same-phone action rather than
 * presenting it as the caller's own claim. Trip-wide calls (no
 * roundId) are unchanged — shared-device pairing is inherently a
 * per-round concept (scorecards.group_id), so widening it without a
 * round to scope against isn't attempted here.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveSharedDeviceGroupForPlayer } from '@/lib/scoring/resolveSharedDeviceGroup'

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

  // Shared-device widening — resolve the caller's paper partner for
  // this specific round (if any), via the LIVE trip_members.group_id
  // (not scorecards.group_id, which the current begin_round() RPC never
  // actually writes — see resolveSharedDeviceGroup.ts for the full
  // trace of why that column can't be trusted). Reuses the exact same
  // resolver every other shared-device check now shares, so this can't
  // drift into its own, independent copy of the rule.
  let sharedDevicePaperPartnerId: string | null = null
  if (roundId) {
    const detection = await resolveSharedDeviceGroupForPlayer(admin, { tripId, roundId, playerId: user.id })
    if (detection.isSharedDevice && detection.digitalPlayerId === user.id) {
      sharedDevicePaperPartnerId = detection.paperPlayerId
    }
  }
  const requiredVerifierIds = sharedDevicePaperPartnerId ? [user.id, sharedDevicePaperPartnerId] : [user.id]

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
    .select('id, side_comp_id, player_id, claimed_value, moment_id, created_at, required_verifier_id, profiles:player_id(full_name)')
    .in('side_comp_id', compIds)
    .eq('verification_status', 'pending')
    .in('required_verifier_id', requiredVerifierIds)
    .order('created_at', { ascending: true })

  const COMP_LABEL: Record<string, string> = { nearest_pin: 'Nearest the Pin', longest_drive: 'Longest Drive', pros_approach: "Pro's Approach" }

  const pending = await Promise.all(((entriesRes.data ?? []) as unknown as {
    id: string; side_comp_id: string; player_id: string; claimed_value: number | null; moment_id: string | null
    created_at: string; required_verifier_id: string; profiles: { full_name: string } | null
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
    const verifyingAsPartner = e.required_verifier_id !== user.id
    // Only fetched for the shared-device widened case — the card needs
    // the actual verifier's name (Marnie) to show "Marnie confirms this
    // result," distinct from the claimant's own name already returned
    // below. Skipped entirely for the ordinary case (verifyingAsPartner
    // false) to avoid an extra query on every normal claim.
    let verifierName: string | null = null
    if (verifyingAsPartner) {
      const verifierProfile = await admin.from('profiles').select('full_name').eq('id', e.required_verifier_id).maybeSingle()
      verifierName = verifierProfile.data?.full_name ?? 'your paper partner'
    }
    return {
      entryId: e.id, sideCompId: e.side_comp_id,
      compType: comp?.comp_type ?? null, compLabel: comp ? (COMP_LABEL[comp.comp_type] ?? comp.comp_type) : 'Side Competition',
      holeNumber: comp?.hole_number ?? null,
      playerId: e.player_id, playerName: e.profiles?.full_name ?? 'Player',
      claimedValue: e.claimed_value, momentUrl,
      // Shared-device widening — true only when this claim's real
      // required verifier is the caller's paper partner, not the caller
      // themselves, so the client can render "Marnie to verify" instead
      // of presenting it as the caller's own pending action.
      verifyingAsPartner,
      verifierName,
    }
  }))

  return NextResponse.json({ pending })
}
