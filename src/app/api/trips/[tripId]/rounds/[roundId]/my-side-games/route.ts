import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

const COMP_TYPE_LABEL: Record<string, { icon: string; label: string }> = {
  nearest_pin:   { icon: '🎯', label: 'Nearest the Pin' },
  pros_approach: { icon: '🎯', label: 'Pro\u2019s Approach' },
  longest_drive: { icon: '🏌️', label: 'Longest Drive' },
}

/**
 * GET /api/trips/[tripId]/rounds/[roundId]/my-side-games
 *
 * My Golf Side Games -- live status (9 Sep), item 4. Read-only,
 * provisional-only -- this route never writes anything, and never
 * shows "Winner." It reads the exact same side_comp_lead_changes
 * table (the canonical, verify-only-written leadership history) the
 * official-winner finalisation now also reads, but never touches
 * side_comps.official_winner_entry_id itself.
 *
 * Deliberately scoped to two states -- "Current Leader" and "Result
 * Entered" -- rather than a full 1st/2nd/3rd ranking. Confirmed before
 * building this that Longest Drive is ordinal (confirm/reject against
 * whoever currently leads, per verify_longest_drive_entry's own
 * signature -- no numeric result_value comparison at all), which is a
 * genuinely different ranking model from Nearest the Pin/Pro's
 * Approach's distance comparison -- computing a correct combined
 * "2nd/3rd" position across both models under time pressure risked
 * inventing new, unverified ranking logic, which the brief explicitly
 * warned against. Two states that are true for every comp type by the
 * same simple rule (is this player's entry the side_comp's current
 * leader, per side_comp_lead_changes' own latest row) is the safer,
 * still-genuinely-useful scope.
 */
export async function GET(_req: Request, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const memberCheck = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberCheck.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

  const compsRes = await admin.from('side_comps')
    .select('id, comp_type, hole_number, official_winner_entry_id')
    .eq('round_id', roundId).eq('trip_id', tripId).eq('enabled', true)

  const comps = compsRes.data ?? []
  if (comps.length === 0) return NextResponse.json({ sideGames: [] })
  const compIds = comps.map((c: { id: string }) => c.id)

  const myEntriesRes = await admin.from('side_comp_entries')
    .select('id, side_comp_id, qualified')
    .in('side_comp_id', compIds).eq('player_id', user.id)
  const myEntryByCompId = new Map((myEntriesRes.data ?? []).map((e: { id: string; side_comp_id: string; qualified: boolean }) => [e.side_comp_id, e]))

  // Latest verified lead-change per side_comp -- the same canonical
  // "who currently leads" query used everywhere else in this app
  // (get_my_golf_summary, finalize_side_comp_winners), not a new one.
  const leadChangesRes = await admin.from('side_comp_lead_changes')
    .select('side_comp_id, player_id, sequence_number')
    .in('side_comp_id', compIds)
    .order('sequence_number', { ascending: false })
  const latestLeaderByCompId = new Map<string, string>()
  for (const lc of (leadChangesRes.data ?? []) as { side_comp_id: string; player_id: string }[]) {
    if (!latestLeaderByCompId.has(lc.side_comp_id)) latestLeaderByCompId.set(lc.side_comp_id, lc.player_id)
  }

  const sideGames = comps
    .map((c: { id: string; comp_type: string; hole_number: number | null; official_winner_entry_id: string | null }) => {
      const myEntry = myEntryByCompId.get(c.id) as { id: string; qualified: boolean } | undefined
      const isLeader = latestLeaderByCompId.get(c.id) === user.id
      const meta = COMP_TYPE_LABEL[c.comp_type] ?? { icon: '🏆', label: c.comp_type }

      let status: 'current_leader' | 'result_entered' | null = null
      if (isLeader) status = 'current_leader'
      else if (myEntry) status = 'result_entered'
      if (!status) return null

      return {
        sideCompId: c.id, compType: c.comp_type, icon: meta.icon, label: meta.label,
        holeNumber: c.hole_number, status,
        // Provisional only -- deliberately never "winner" here, even
        // if official_winner_entry_id is already set for a closed
        // round: this route's whole purpose is the live view, and the
        // official result belongs to Practice History/round summary
        // reads instead, not this endpoint.
      }
    })
    .filter((s: unknown): s is NonNullable<typeof s> => s !== null)

  return NextResponse.json({ sideGames })
}
