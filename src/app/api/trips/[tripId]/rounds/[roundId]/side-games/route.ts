/**
 * GET /api/trips/[tripId]/rounds/[roundId]/side-games
 *
 * The live status data for this round's Side Games screen: each
 * configured competition's current leader, full leadership history
 * (from the append-only side_comp_lead_changes log — never derived by
 * replaying mutable side_comp_entries), whether it's genuinely finished
 * (every relevant player has actually played that hole, not just "one
 * group finished"), and — once finished — its winner. Also the
 * Powerplay highlight, derived directly from score_entries.stableford_pts
 * on the Powerplay hole (the same authoritative value the Postgres
 * trigger already computed), not a second manually-entered result.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }

interface LeadChangeRow { id: string; player_id: string; result_value: number; sequence_number: number; moment_id: string | null; profiles: { full_name: string } | null }
interface EntryRow { id: string; player_id: string; qualified: boolean; result_value: number | null; moment_id: string | null; profiles: { full_name: string } | null }

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

    type AdminClient = ReturnType<typeof createAdminClient>
    const admin: AdminClient = createAdminClient()

    const memberCheck = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
    if (!memberCheck.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

    const roundRes = await admin.from('rounds').select('id, holes, score_capture_mode').eq('id', roundId).eq('trip_id', tripId).maybeSingle()
    if (!roundRes.data) return NextResponse.json({ error: 'Round not found.' }, { status: 404 })

    // Every configured competition instance, including however many
    // Powerplay holes exist — comp_type = 'powerplay' rows are no longer
    // special-cased into a separate query/field. Corrected model: a round
    // can hold multiple instances of the same type (two NTPs, two
    // Powerplay holes), so this list is never grouped or deduped by
    // comp_type — each row is independently identified by its own id.
    const compsRes = await admin.from('side_comps').select('id, comp_type, hole_number').eq('round_id', roundId).eq('enabled', true).order('hole_number', { ascending: true })
    const comps = compsRes.data ?? []

    // Closure signal, computed once and reused for every competition:
    // has every active (non-withdrawn) scorecard actually recorded a
    // self-captured score for a given hole_number? Same underlying data
    // and reasoning as close/route.ts's own "is the round complete"
    // check (migration/logic already proven for the whole-round case),
    // narrowed here to a single hole instead of every hole — reliably
    // answers "can this specific competition's hole no longer change"
    // without inventing a new signal.
    const scRes = await admin.from('scorecards')
      .select('id, status, score_entries(hole_id, capture_role)')
      .eq('round_id', roundId).neq('status', 'withdrawn')
    const holesRes = await admin.from('holes').select('id, hole_number').eq('round_id', roundId)
    const holeIdByNumber = new Map<number, string>((holesRes.data ?? []).map((h: { id: string; hole_number: number }) => [h.hole_number, h.id]))
    const activeScorecardCount = (scRes.data ?? []).length

    function isHoleComplete(holeNumber: number | null): boolean {
      if (holeNumber === null || activeScorecardCount === 0) return false
      const holeId = holeIdByNumber.get(holeNumber)
      if (!holeId) return false
      return (scRes.data ?? []).every((sc: { score_entries: { hole_id: string; capture_role: string }[] }) =>
        (sc.score_entries ?? []).some(e => e.hole_id === holeId && e.capture_role === 'self')
      )
    }

    // One signed-URL lookup helper, reused for every leader/winner thumbnail.
    async function momentThumb(momentId: string | null): Promise<string | null> {
      if (!momentId) return null
      const momentRes = await admin.from('moments').select('image_path').eq('id', momentId).maybeSingle()
      if (!momentRes.data?.image_path) return null
      const signed = await admin.storage.from('event-moments').createSignedUrl(momentRes.data.image_path, 3600)
      return signed.data?.signedUrl ?? null
    }

    const competitions = await Promise.all(comps.map(async (comp) => {
      // Powerplay is a genuinely different kind of competition — not a
      // player-submitted result with a leader, but a scoring modifier.
      // Its "highlight" is the best authoritative score on this specific
      // Powerplay hole (score_entries.stableford_pts, already doubled by
      // the trigger — never a second manually-entered result), computed
      // independently per instance so two Powerplay holes in one round
      // each get their own, correct highlight rather than being merged.
      if (comp.comp_type === 'powerplay') {
        let powerplayBest: { playerId: string; playerName: string; points: number } | null = null
        const ppHoleId = holeIdByNumber.get(comp.hole_number)
        if (ppHoleId) {
          const { data: ppEntries } = await admin
            .from('score_entries')
            .select('stableford_pts, scorecard_id')
            .eq('hole_id', ppHoleId).eq('capture_role', 'self')
          const topEntry = ((ppEntries ?? []) as { stableford_pts: number | null; scorecard_id: string }[])
            .filter(e => e.stableford_pts !== null)
            .sort((a, b) => (b.stableford_pts ?? 0) - (a.stableford_pts ?? 0))[0]
          if (topEntry) {
            const { data: sc } = await admin.from('scorecards').select('player_id, profiles:player_id(full_name)').eq('id', topEntry.scorecard_id).maybeSingle()
            const scRow = sc as unknown as { player_id: string; profiles: { full_name: string } | null } | null
            if (scRow) powerplayBest = { playerId: scRow.player_id, playerName: scRow.profiles?.full_name ?? 'Player', points: topEntry.stableford_pts ?? 0 }
          }
        }
        return {
          id: comp.id, compType: comp.comp_type, holeNumber: comp.hole_number,
          currentLeader: null, leadChangeCount: 0, hotlyContested: false,
          isComplete: isHoleComplete(comp.hole_number), winner: null, history: [],
          powerplayBest,
        }
      }

      const [entriesRes, changesRes] = await Promise.all([
        admin.from('side_comp_entries').select('id, player_id, qualified, result_value, moment_id, profiles:player_id(full_name)').eq('side_comp_id', comp.id),
        admin.from('side_comp_lead_changes').select('id, player_id, result_value, sequence_number, moment_id, profiles:player_id(full_name)').eq('side_comp_id', comp.id).order('sequence_number', { ascending: true }),
      ])
      const entries = (entriesRes.data ?? []) as unknown as EntryRow[]
      const changes = (changesRes.data ?? []) as unknown as LeadChangeRow[]

      // Current leader — same derivation as the entries route: value-
      // based live query for NTP/Pro's Approach, log-walk (verified
      // against current qualified flags) for Longest Drive.
      let currentLeader: { playerId: string; playerName: string; resultValue: number | null; momentUrl: string | null } | null = null
      if (comp.comp_type === 'longest_drive') {
        for (let i = changes.length - 1; i >= 0; i--) {
          const entry = entries.find(e => e.player_id === changes[i].player_id)
          if (entry?.qualified) {
            currentLeader = { playerId: changes[i].player_id, playerName: changes[i].profiles?.full_name ?? 'Player', resultValue: null, momentUrl: await momentThumb(entry.moment_id ?? changes[i].moment_id) }
            break
          }
        }
      } else {
        const qualified = entries.filter(e => e.qualified && e.result_value !== null).sort((a, b) => (a.result_value ?? 0) - (b.result_value ?? 0))
        const best = qualified[0]
        if (best) currentLeader = { playerId: best.player_id, playerName: best.profiles?.full_name ?? 'Player', resultValue: best.result_value, momentUrl: await momentThumb(best.moment_id) }
      }

      const complete = isHoleComplete(comp.hole_number)
      return {
        id: comp.id, compType: comp.comp_type, holeNumber: comp.hole_number,
        currentLeader,
        leadChangeCount: changes.length,
        hotlyContested: changes.length >= 5,
        isComplete: complete,
        winner: complete ? currentLeader : null,
        history: changes.map(c => ({ playerName: c.profiles?.full_name ?? 'Player', resultValue: c.result_value, sequenceNumber: c.sequence_number })),
        powerplayBest: null as { playerId: string; playerName: string; points: number } | null,
      }
    }))

    return NextResponse.json({ competitions })
  } catch (err) {
    console.error('[side-games]', err)
    return NextResponse.json({ error: 'Could not load Side Games.' }, { status: 500 })
  }
}
