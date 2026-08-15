/**
 * The per-round Side Games computation — current leader/winner, full
 * leadership history, hole-closure, Powerplay highlight — extracted from
 * the original single-round route so it has exactly one implementation,
 * called from two places (individual-round drill-down, and the new
 * event-level aggregation) rather than duplicated between them. Nothing
 * about this function's own logic changed in this extraction; every
 * comment/reasoning from the original route is preserved verbatim below.
 */
import { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

interface LeadChangeRow { id: string; player_id: string; result_value: number; sequence_number: number; moment_id: string | null; profiles: { full_name: string } | null }
interface EntryRow { id: string; player_id: string; qualified: boolean; result_value: number | null; verification_status: string; moment_id: string | null; profiles: { full_name: string } | null }

export interface SideGameCompetition {
  id: string; compType: string; holeNumber: number | null
  currentLeader: { playerId: string; playerName: string; resultValue: number | null; momentUrl: string | null } | null
  leadChangeCount: number; hotlyContested: boolean
  isComplete: boolean
  winner: { playerId: string; playerName: string; resultValue: number | null; momentUrl: string | null } | null
  history: { playerName: string; resultValue: number | null; sequenceNumber: number }[]
  powerplayBest: { playerId: string; playerName: string; points: number } | null
}

export async function computeRoundSideGames(admin: AdminClient, roundId: string): Promise<SideGameCompetition[]> {
  const compsRes = await admin.from('side_comps').select('id, comp_type, hole_number').eq('round_id', roundId).eq('enabled', true).order('hole_number', { ascending: true })
  const comps = compsRes.data ?? []

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

  async function momentThumb(momentId: string | null): Promise<string | null> {
    if (!momentId) return null
    const momentRes = await admin.from('moments').select('image_path').eq('id', momentId).maybeSingle()
    if (!momentRes.data?.image_path) return null
    const signed = await admin.storage.from('event-moments').createSignedUrl(momentRes.data.image_path, 3600)
    return signed.data?.signedUrl ?? null
  }

  return Promise.all(comps.map(async (comp): Promise<SideGameCompetition> => {
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
      admin.from('side_comp_entries').select('id, player_id, qualified, result_value, verification_status, moment_id, profiles:player_id(full_name)').eq('side_comp_id', comp.id),
      admin.from('side_comp_lead_changes').select('id, player_id, result_value, sequence_number, moment_id, profiles:player_id(full_name)').eq('side_comp_id', comp.id).order('sequence_number', { ascending: true }),
    ])
    const entries = (entriesRes.data ?? []) as unknown as EntryRow[]
    const changes = (changesRes.data ?? []) as unknown as LeadChangeRow[]

    let currentLeader: { playerId: string; playerName: string; resultValue: number | null; momentUrl: string | null } | null = null
    if (comp.comp_type === 'longest_drive') {
      for (let i = changes.length - 1; i >= 0; i--) {
        const entry = entries.find(e => e.player_id === changes[i].player_id)
        if (entry?.qualified && entry.verification_status === 'verified') {
          currentLeader = { playerId: changes[i].player_id, playerName: changes[i].profiles?.full_name ?? 'Player', resultValue: null, momentUrl: await momentThumb(entry.moment_id ?? changes[i].moment_id) }
          break
        }
      }
    } else {
      const qualified = entries.filter(e => e.qualified && e.verification_status === 'verified' && e.result_value !== null).sort((a, b) => (a.result_value ?? 0) - (b.result_value ?? 0))
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
      powerplayBest: null,
    }
  }))
}
