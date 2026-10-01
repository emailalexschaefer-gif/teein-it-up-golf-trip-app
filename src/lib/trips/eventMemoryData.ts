/**
 * Event Memories V1.1 Phase 2 (11 Sep) -- the shared data-fetching
 * core, extracted from memory-manifest/route.ts so the new export
 * route can read the exact same canonical data rather than
 * duplicating this query logic a second time, per the explicit "do
 * not create a second competing source of truth" instruction.
 *
 * memory-manifest/route.ts itself now calls this function and returns
 * its result directly -- its own response shape is unchanged, so
 * nothing consuming that route (the gallery page) needs to change.
 *
 * Every provenance decision documented in memory-manifest/route.ts's
 * own file-level comment (sourceType, Side Game reverse-link,
 * side_comps.name as the authoritative label, deferred champion)
 * applies identically here -- this is the same logic, relocated, not
 * reimplemented.
 */
import { createAdminClient } from '@/lib/supabase/admin'

const SIDE_COMP_LABEL: Record<string, string> = {
  nearest_pin: 'Nearest the Pin', longest_drive: 'Longest Drive', pros_approach: "Pro's Approach", powerplay: 'Powerplay',
}

export type MemorySourceType = 'GENERAL' | 'SIDE_GAME' | 'CHAT' | 'MAKER' | 'BREAKER' | 'HIGHLIGHT'

export interface EventMemoryData {
  event: { id: string; name: string; eventType: string | null; location: string | null; startDate: string | null; endDate: string | null; status: string }
  rounds: { id: string; ordinal: number | null; name: string; courseName: string | null; playDate: string; status: string; holes: number; publishedHighlights: unknown }[]
  memories: {
    momentId: string; roundId: string | null; roundOrdinal: number | null; holeNumber: number | null
    playerId: string; playerName: string | null; capturedBy: string | null; capturedByName: string | null
    caption: string | null; imagePath: string; imageUrl: string | null; audience: string
    createdAt: string; organiserFavourite: boolean
    sourceType: MemorySourceType; sideCompId: string | null; sideCompName: string | null; sideCompType: string | null
  }[]
  sideGameWinners: { sideCompId: string; roundId: string; compType: string; label: string; holeNumber: number | null; winnerPlayerId: string | null; winnerName: string | null }[]
  playerCount: number
  results: { champion: null }
}

/** generateSignedUrls: false skips the batch signed-URL call entirely
 * -- the export route fetches each image's bytes directly via the
 * admin client and has no use for a browser-facing signed URL, so
 * this avoids an unnecessary Storage round-trip for every photo in a
 * potentially 100+ photo export. */
export async function fetchEventMemoryData(tripId: string, options: { generateSignedUrls: boolean } = { generateSignedUrls: true }): Promise<EventMemoryData | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const tripRes = await admin.from('trips').select('id, name, event_type, location, start_date, end_date, status, organiser_id').eq('id', tripId).maybeSingle()
  if (!tripRes.data) return null

  const roundsRes = await admin.from('rounds')
    .select('id, name, course_name, play_date, status, holes')
    .eq('trip_id', tripId)
    .order('play_date', { ascending: true })
  const rounds = roundsRes.data ?? []
  const roundIds = rounds.map((r: { id: string }) => r.id)
  const roundOrdinalById = new Map(rounds.map((r: { id: string }, i: number) => [r.id, i + 1]))

  const membersRes = await admin.from('trip_members').select('profile_id').eq('trip_id', tripId)
  const playerCount = new Set(((membersRes.data ?? []) as { profile_id: string }[]).map(m => m.profile_id)).size

  const momentsRes = await admin.from('moments')
    .select('id, round_id, hole_number, player_id, captured_by, caption, image_path, audience, created_at, is_event_favourite, profiles:player_id(full_name)')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true })
  const moments = momentsRes.data ?? []

  const capturedByIds = [...new Set((moments as { captured_by: string | null }[]).map(m => m.captured_by).filter((id): id is string => id !== null))]
  const capturedByProfilesRes = capturedByIds.length > 0
    ? await admin.from('profiles').select('id, full_name').in('id', capturedByIds)
    : { data: [] }
  const nameByCapturedById = new Map(((capturedByProfilesRes.data ?? []) as { id: string; full_name: string }[]).map(p => [p.id, p.full_name]))

  const sideCompsRes = roundIds.length > 0
    ? await admin.from('side_comps').select('id, round_id, name, comp_type, hole_number, official_winner_entry_id').in('round_id', roundIds)
    : { data: [] }
  interface SideCompRow { id: string; round_id: string; name: string; comp_type: string; hole_number: number | null; official_winner_entry_id: string | null }
  const sideComps = (sideCompsRes.data ?? []) as SideCompRow[]
  const sideCompById = new Map(sideComps.map(sc => [sc.id, sc]))

  const sideCompIds = sideComps.map(sc => sc.id)
  const entriesRes = sideCompIds.length > 0
    ? await admin.from('side_comp_entries').select('id, side_comp_id, player_id, moment_id').in('side_comp_id', sideCompIds).not('moment_id', 'is', null)
    : { data: [] }
  const leadChangesRes = sideCompIds.length > 0
    ? await admin.from('side_comp_lead_changes').select('side_comp_id, moment_id').in('side_comp_id', sideCompIds).not('moment_id', 'is', null)
    : { data: [] }
  const sideCompIdByMomentId = new Map<string, string>()
  for (const lc of (leadChangesRes.data ?? []) as { side_comp_id: string; moment_id: string }[]) {
    sideCompIdByMomentId.set(lc.moment_id, lc.side_comp_id)
  }
  for (const e of (entriesRes.data ?? []) as { id: string; side_comp_id: string; player_id: string; moment_id: string }[]) {
    sideCompIdByMomentId.set(e.moment_id, e.side_comp_id)
  }

  const winnerEntryIds = sideComps.map(sc => sc.official_winner_entry_id).filter((id): id is string => id !== null)
  const winningEntriesRes = winnerEntryIds.length > 0
    ? await admin.from('side_comp_entries').select('id, player_id').in('id', winnerEntryIds)
    : { data: [] }
  const playerIdByEntryId = new Map(((winningEntriesRes.data ?? []) as { id: string; player_id: string }[]).map(e => [e.id, e.player_id]))
  const winnerPlayerIds = [...new Set([...playerIdByEntryId.values()])]
  const winnerProfilesRes = winnerPlayerIds.length > 0
    ? await admin.from('profiles').select('id, full_name').in('id', winnerPlayerIds)
    : { data: [] }
  const nameByPlayerId = new Map(((winnerProfilesRes.data ?? []) as { id: string; full_name: string }[]).map(p => [p.id, p.full_name]))

  const sideGameWinners = sideComps
    .filter(sc => sc.official_winner_entry_id !== null)
    .map(sc => {
      const playerId = playerIdByEntryId.get(sc.official_winner_entry_id as string) ?? null
      return {
        sideCompId: sc.id, roundId: sc.round_id,
        compType: sc.comp_type, label: sc.name || SIDE_COMP_LABEL[sc.comp_type] || sc.comp_type,
        holeNumber: sc.hole_number,
        winnerPlayerId: playerId,
        winnerName: playerId ? nameByPlayerId.get(playerId) ?? null : null,
      }
    })

  const highlightsRes = roundIds.length > 0
    ? await admin.from('published_round_highlights').select('round_id, highlights, published_at').in('round_id', roundIds)
    : { data: [] }
  const highlightsByRoundId = new Map(
    ((highlightsRes.data ?? []) as { round_id: string; highlights: unknown; published_at: string }[]).map(h => [h.round_id, h])
  )

  let signedUrlByPath = new Map<string, string>()
  if (options.generateSignedUrls) {
    const imagePaths = moments.map((m: { image_path: string }) => m.image_path)
    const signedUrlsRes = imagePaths.length > 0
      ? await admin.storage.from('event-moments').createSignedUrls(imagePaths, 3600)
      : { data: [] }
    signedUrlByPath = new Map(
      ((signedUrlsRes.data ?? []) as { path: string | null; signedUrl: string }[])
        .filter((r): r is { path: string; signedUrl: string } => r.path !== null)
        .map(r => [r.path, r.signedUrl])
    )
  }

  return {
    event: {
      id: tripRes.data.id, name: tripRes.data.name, eventType: tripRes.data.event_type,
      location: tripRes.data.location, startDate: tripRes.data.start_date, endDate: tripRes.data.end_date,
      status: tripRes.data.status,
    },
    rounds: rounds.map((r: { id: string; name: string; course_name: string | null; play_date: string; status: string; holes: number }) => ({
      id: r.id, ordinal: roundOrdinalById.get(r.id) ?? null, name: r.name, courseName: r.course_name, playDate: r.play_date, status: r.status, holes: r.holes,
      publishedHighlights: highlightsByRoundId.get(r.id)?.highlights ?? null,
    })),
    memories: moments.map((m: {
      id: string; round_id: string | null; hole_number: number | null; player_id: string; captured_by: string | null
      caption: string | null; image_path: string; audience: string; created_at: string
      is_event_favourite: boolean; profiles: { full_name: string } | null
    }) => {
      const linkedSideCompId = sideCompIdByMomentId.get(m.id) ?? null
      const linkedSideComp = linkedSideCompId ? sideCompById.get(linkedSideCompId) ?? null : null
      const sourceType: MemorySourceType = linkedSideComp ? 'SIDE_GAME' : 'GENERAL'
      return {
        momentId: m.id, roundId: m.round_id, roundOrdinal: m.round_id ? roundOrdinalById.get(m.round_id) ?? null : null,
        holeNumber: m.hole_number,
        playerId: m.player_id, playerName: m.profiles?.full_name ?? null,
        capturedBy: m.captured_by, capturedByName: m.captured_by ? nameByCapturedById.get(m.captured_by) ?? null : null,
        caption: m.caption, imagePath: m.image_path, imageUrl: signedUrlByPath.get(m.image_path) ?? null, audience: m.audience,
        createdAt: m.created_at, organiserFavourite: m.is_event_favourite,
        sourceType,
        sideCompId: linkedSideComp?.id ?? null,
        sideCompName: linkedSideComp ? (linkedSideComp.name || SIDE_COMP_LABEL[linkedSideComp.comp_type] || linkedSideComp.comp_type) : null,
        sideCompType: linkedSideComp?.comp_type ?? null,
      }
    }),
    sideGameWinners,
    playerCount,
    results: { champion: null },
  }
}
