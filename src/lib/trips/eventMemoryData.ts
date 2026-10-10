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
 * side_comps.name as the authoritative label) applies identically
 * here -- this is the same logic, relocated, not reimplemented.
 *
 * EXTENDED for Event Memories V1.3 (13 Sep): `results.champion` was
 * deferred in V1.1/V1.2 specifically because computing it correctly
 * needed the same complex countback logic final-results/route.ts
 * already had, and re-implementing it here would have either
 * duplicated that logic or risked a second, subtly different
 * calculation. That route's computation is now extracted into
 * computeFinalResults (finalResults.ts) -- moved verbatim, not
 * rewritten (confirmed by diffing the extracted body against the
 * original route line for line). This function now calls that shared
 * computation directly, only when the trip is actually completed
 * (matching computeFinalResults' own gate) -- a live/incomplete event
 * still correctly gets `results: null`, never a guessed or partial
 * result.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { computeFinalResults, type FinalResultsResult } from './finalResults'
import { determineRoundWinners, determineRoundStandings } from '@/lib/scoring/multiRound'
import { computeRoundSideGames } from '@/lib/sideGames/computeRoundSideGames'
import { resolveSideGameWinner, type SideCompForResolution } from './resolveSideGameWinner'

const SIDE_COMP_LABEL: Record<string, string> = {
  nearest_pin: 'Nearest the Pin', longest_drive: 'Longest Drive', pros_approach: "Pro's Approach", powerplay: 'Powerplay',
}

export type MemorySourceType = 'GENERAL' | 'SIDE_GAME' | 'CHAT' | 'MAKER' | 'BREAKER' | 'HIGHLIGHT'

export interface EventFinalResults {
  champions: { playerId: string; playerName: string; totalPoints: number }[]
  hasTie: boolean
  standings: { playerId: string; playerName: string; totalPoints: number; position: number }[]
}

export interface EventMemoryData {
  event: { id: string; name: string; eventType: string | null; location: string | null; startDate: string | null; endDate: string | null; status: string; groupPhotoMomentId: string | null; championPhotoMomentId: string | null }
  rounds: {
    id: string; ordinal: number | null; name: string; courseName: string | null; playDate: string; status: string; holes: number; publishedHighlights: unknown
    // V1.5 completion patch (15 Sep) -- null for a round not yet
    // completed (never a mid-round snapshot); an empty array for a
    // completed round with no scorecards at all (never a fabricated
    // winner); otherwise every player tied for the round's own
    // highest points, exactly as determineRoundWinners itself
    // guarantees.
    winners: { playerId: string; playerName: string; points: number }[] | null
    // V1.14 (8 Oct) -- Round Top-5 standings, for the Round Results
    // slide. Same null-when-not-completed convention as winners above
    // -- never a mid-round snapshot presented as a result.
    standings: { playerId: string; playerName: string; roundPoints: number; position: number }[] | null
  }[]
  memories: {
    momentId: string; roundId: string | null; roundOrdinal: number | null; holeNumber: number | null
    // V1.18 (10 Oct), migration 095 -- playerId is now nullable: an
    // organiser-uploaded, event-level Moment (e.g. a WhatsApp photo
    // with unreliable metadata) genuinely has no identifiable subject.
    // Never defaulted to the uploader -- see capturedBy for who
    // actually uploaded it in that case.
    playerId: string | null; playerName: string | null; capturedBy: string | null; capturedByName: string | null
    caption: string | null; imagePath: string; imageUrl: string | null; audience: string
    createdAt: string; organiserFavourite: boolean
    sourceType: MemorySourceType; sideCompId: string | null; sideCompName: string | null; sideCompType: string | null
    // V1.4 (14 Sep) -- migration 086. mediaType distinguishes a video
    // Moment from a photo one; durationSeconds is required and
    // authoritative for a video (never re-derived from the file at
    // render time); isBlooper is the organiser's own explicit
    // selection for the Bloopers/Outtakes chapter, never inferred
    // from mediaType alone.
    mediaType: 'photo' | 'text' | 'video'; durationSeconds: number | null; isBlooper: boolean
    // V1.18 (10 Oct), migration 095 -- the organiser's own explicit
    // override for this Moment's inclusion in the "Moments & Bloopers"
    // aftershow chapter. NULL means "not yet decided -- follow the
    // automatic suggestion" (see resolveAftershowMomentIds in
    // slideshowDeck.ts, the single place this is resolved). An
    // independent, presentation-only selection -- never a Moment
    // classification alongside Favourite/Blooper.
    aftershowIncluded: boolean | null
  }[]
  sideGameWinners: { sideCompId: string; roundId: string; compType: string; label: string; holeNumber: number | null; winnerPlayerId: string | null; winnerName: string | null }[]
  // V1.7 (6 Oct) -- for Event-at-a-Glance's "X Side Games": every
  // Side Game configured for the event, regardless of whether a
  // winner has been declared yet -- deliberately broader than
  // sideGameWinners.length, which only counts finalized ones.
  sideGameCount: number
  playerCount: number
  results: { champion: EventFinalResults | null }
}

/** generateSignedUrls: false skips the batch signed-URL call entirely
 * -- the export route fetches each image's bytes directly via the
 * admin client and has no use for a browser-facing signed URL, so
 * this avoids an unnecessary Storage round-trip for every photo in a
 * potentially 100+ photo export. */
export async function fetchEventMemoryData(tripId: string, options: { generateSignedUrls: boolean } = { generateSignedUrls: true }): Promise<EventMemoryData | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const tripRes = await admin.from('trips').select('id, name, event_type, location, start_date, end_date, status, organiser_id, group_photo_moment_id, champion_photo_moment_id').eq('id', tripId).maybeSingle()
  if (!tripRes.data) return null

  const roundsRes = await admin.from('rounds')
    .select('id, name, course_name, play_date, status, holes')
    .eq('trip_id', tripId)
    .order('play_date', { ascending: true })
  const rounds = roundsRes.data ?? []
  const roundIds = rounds.map((r: { id: string }) => r.id)
  const roundOrdinalById = new Map(rounds.map((r: { id: string }, i: number) => [r.id, i + 1]))

  // V1.5 completion patch (15 Sep) -- Round Winner, audited and
  // confirmed derivable from existing round-scoped scoring data,
  // without any schema change. Reuses determineRoundWinners
  // (multiRound.ts) -- the exact same tie-safe, "never pick one
  // arbitrarily" pure function computeFinalResults (finalResults.ts)
  // already calls for its own per-round winners -- fed here from a
  // simpler, round-scoped query rather than that function's own full
  // event-wide computation, which is deliberately gated on the ENTIRE
  // EVENT being status='completed' (confirmed by reading it directly)
  // and so cannot answer "who won Round 1" while Round 2/3 are still
  // being played -- exactly the brief's own "after Round 1 they can
  // make a recap" use case. determineRoundWinners itself only ever
  // reads roundPoints, never holePoints -- confirmed directly, so no
  // countback/hole-sequence data is fetched here at all, only the sum
  // of stableford_pts per player, the minimum this function needs.
  // Only ever computed for a round whose own status is 'completed' --
  // never a mid-round snapshot presented as a "result."
  const completedRoundIds = rounds.filter((r: { status: string }) => r.status === 'completed').map((r: { id: string }) => r.id)
  const roundWinnersByRoundId = new Map<string, { playerId: string; playerName: string; points: number }[]>()
  // V1.14 (8 Oct) -- Round Top-5 standings, per the brief's own "do not
  // create a second scoring implementation" instruction: this reuses
  // the exact same playerResults this block already computes for
  // determineRoundWinners, feeding it into determineRoundStandings
  // (multiRound.ts) as well -- no second query, no recomputed points,
  // just a second, ranked view of the same already-derived data.
  const roundStandingsByRoundId = new Map<string, { playerId: string; playerName: string; roundPoints: number; position: number }[]>()
  if (completedRoundIds.length > 0) {
    const roundResultsArrays = await Promise.all(completedRoundIds.map(async (roundId: string) => {
      const scorecardsRes = await admin.from('scorecards')
        .select('player_id, profiles:player_id(full_name), score_entries(stableford_pts, capture_role)')
        .eq('round_id', roundId).neq('status', 'withdrawn')
      const playerResults = ((scorecardsRes.data ?? []) as unknown as { player_id: string; profiles: { full_name: string } | null; score_entries: { stableford_pts: number | null; capture_role: string }[] }[])
        .map(sc => ({
          playerId: sc.player_id, playerName: sc.profiles?.full_name ?? 'Player',
          roundPoints: (sc.score_entries ?? []).filter(e => e.capture_role === 'self').reduce((sum, e) => sum + (e.stableford_pts ?? 0), 0),
          holePoints: [],
        }))
      return { roundId, winners: determineRoundWinners(playerResults), standings: determineRoundStandings(playerResults) }
    }))
    for (const r of roundResultsArrays) {
      roundWinnersByRoundId.set(r.roundId, r.winners)
      roundStandingsByRoundId.set(r.roundId, r.standings)
    }
  }

  const membersRes = await admin.from('trip_members').select('profile_id').eq('trip_id', tripId)
  const playerCount = new Set(((membersRes.data ?? []) as { profile_id: string }[]).map(m => m.profile_id)).size

  const momentsRes = await admin.from('moments')
    .select('id, round_id, hole_number, player_id, captured_by, caption, image_path, audience, created_at, is_event_favourite, moment_type, duration_seconds, is_blooper, aftershow_included, profiles:player_id(full_name)')
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

  // V1.11 (7 Oct) -- ROOT CAUSE TRACE for "Round 2 Side Game Winners
  // missing from the slideshow despite the live Side Games screen
  // showing them," confirmed by comparing this query against the live
  // screen's own data path (src/lib/sideGames/computeRoundSideGames.ts,
  // used by src/app/api/.../side-games/route.ts), not assumed:
  //
  // This query (and therefore the slideshow) only ever reads
  // side_comps.official_winner_entry_id -- a column that is EXCLUSIVELY
  // written by the finalize_side_comp_winners() RPC, which is in turn
  // ONLY ever called from the round-close route (confirmed directly
  // in close/route.ts). The live Side Games screen does NOT read this
  // column at all -- computeRoundSideGames.ts computes its own
  // "winner" dynamically, per Side Game, as `complete ? currentLeader
  // : null`, where `complete` is `isHoleComplete(comp.hole_number)` --
  // whether every player has finished THAT SPECIFIC HOLE, entirely
  // independent of the round's own open/closed status.
  //
  // This means a Side Game tied to an early hole (Hole 1, Hole 6) can
  // genuinely show "WINNER: Alex Schaefer" in the live screen the
  // moment everyone has played that one hole -- while the round itself
  // (and therefore official_winner_entry_id) remains unset until the
  // ENTIRE round is formally closed, which can happen much later, or
  // not yet at all. Round 1 and Round 3 having their Side Game
  // Winners section available while Round 2 does not is consistent
  // with Round 1 and Round 3 having already been closed while Round 2
  // has not -- its Side Games are individually complete and showing
  // live winners, but the round itself hasn't been closed yet, so
  // official_winner_entry_id is still null for both of its Side Games.
  //
  // This was NOT verifiable with certainty from this environment --
  // there is no database access here to directly confirm Round 2's
  // actual status column. It is reported as the precise, evidence-
  // based explanation this trace produced, not a confirmed fact. No
  // change was made to the winner-source logic itself: doing so would
  // mean the slideshow could show a still-provisional, not-yet-
  // officially-finalized leader as a declared winner, which is a
  // scoring/results-semantics decision (whether a Side Game Winner
  // slide should be allowed before the round is formally closed) --
  // squarely outside a presentation-focused pass, per the explicit
  // "do not touch scoring/event logic merely because this pass
  // includes visual changes" instruction. See the delivery report for
  // the two options this leaves for the next pass if Round 2 is
  // confirmed not yet closed.
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

  // V1.12 (7 Oct) -- the canonical resolver fix for the V1.11 root
  // cause above. rounds.status === 'completed' is the existing,
  // canonical finalisation field (confirmed authoritative: it's the
  // exact value the round-close route sets at the same moment it
  // calls finalize_side_comp_winners(), and the same field
  // get_my_golf_summary()'s own self-healing reconciliation already
  // treats as the finalisation gate -- no new flag introduced).
  //
  // The pre-finalisation fallback reuses computeRoundSideGames(), the
  // exact function backing the live Side Games screen, rather than
  // reimplementing its completion/winner logic a second time here --
  // called ONLY for rounds not yet 'completed', since a finalised
  // round's winners are already fully resolved by the official path
  // and never need the fallback, keeping the added query cost scoped
  // to exactly the rounds that need it.
  const roundStatusById = new Map(rounds.map((r: { id: string; status: string }) => [r.id, r.status]))
  const unfinalisedRoundIds = [...new Set(sideComps.map(sc => sc.round_id))].filter(rid => roundStatusById.get(rid) !== 'completed')
  const fallbackByRoundId = new Map<string, Awaited<ReturnType<typeof computeRoundSideGames>>>()
  for (const rid of unfinalisedRoundIds) {
    fallbackByRoundId.set(rid, await computeRoundSideGames(admin, rid))
  }

  const sideGameWinners = sideComps.map(sc => {
    const roundIsFinalised = roundStatusById.get(sc.round_id) === 'completed'
    const officialPlayerId = sc.official_winner_entry_id ? (playerIdByEntryId.get(sc.official_winner_entry_id) ?? null) : null
    const comp: SideCompForResolution = {
      id: sc.id, roundId: sc.round_id, compType: sc.comp_type,
      label: sc.name || SIDE_COMP_LABEL[sc.comp_type] || sc.comp_type, holeNumber: sc.hole_number,
      officialWinnerPlayerId: officialPlayerId,
      // Same 'Player' fallback as before (a profile with no full_name
      // set, or a lookup miss) -- officialWinnerPlayerId non-null
      // always implies a non-null display name here too.
      officialWinnerName: officialPlayerId ? (nameByPlayerId.get(officialPlayerId) ?? 'Player') : null,
    }
    const fallbackEntry = fallbackByRoundId.get(sc.round_id)?.find(c => c.id === sc.id)
    const fallbackWinner = fallbackEntry?.winner ? { playerId: fallbackEntry.winner.playerId, playerName: fallbackEntry.winner.playerName } : null
    return resolveSideGameWinner(comp, roundIsFinalised, fallbackWinner)
  }).filter(w => w.winnerPlayerId !== null)

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

  // Champion/standings -- only attempted once the trip is actually
  // completed, matching computeFinalResults' own gate exactly (it
  // returns ok: false for a live/incomplete event or a practice trip).
  // A live event correctly gets `champion: null` here, never a
  // guessed or partial result from an in-progress computation.
  let champion: EventFinalResults | null = null
  if (tripRes.data.status === 'completed') {
    const finalResultsResult: FinalResultsResult = await computeFinalResults(tripId, admin)
    if (finalResultsResult.ok) {
      champion = {
        champions: finalResultsResult.data.champions,
        hasTie: finalResultsResult.data.hasTie,
        standings: (finalResultsResult.data.standings as { playerId: string; playerName: string; totalPoints: number; position: number }[])
          .map(s => ({ playerId: s.playerId, playerName: s.playerName, totalPoints: s.totalPoints, position: s.position })),
      }
    }
  }

  return {
    event: {
      id: tripRes.data.id, name: tripRes.data.name, eventType: tripRes.data.event_type,
      location: tripRes.data.location, startDate: tripRes.data.start_date, endDate: tripRes.data.end_date,
      status: tripRes.data.status, groupPhotoMomentId: tripRes.data.group_photo_moment_id,
      championPhotoMomentId: tripRes.data.champion_photo_moment_id,
    },
    rounds: rounds.map((r: { id: string; name: string; course_name: string | null; play_date: string; status: string; holes: number }) => ({
      id: r.id, ordinal: roundOrdinalById.get(r.id) ?? null, name: r.name, courseName: r.course_name, playDate: r.play_date, status: r.status, holes: r.holes,
      publishedHighlights: highlightsByRoundId.get(r.id)?.highlights ?? null,
      winners: r.status === 'completed' ? (roundWinnersByRoundId.get(r.id) ?? []) : null,
      standings: r.status === 'completed' ? (roundStandingsByRoundId.get(r.id) ?? []) : null,
    })),
    memories: moments.map((m: {
      id: string; round_id: string | null; hole_number: number | null; player_id: string | null; captured_by: string | null
      caption: string | null; image_path: string; audience: string; created_at: string
      is_event_favourite: boolean; moment_type: 'photo' | 'text' | 'video'; duration_seconds: number | null; is_blooper: boolean
      aftershow_included: boolean | null
      profiles: { full_name: string } | null
    }) => {
      const linkedSideCompId = sideCompIdByMomentId.get(m.id) ?? null
      const linkedSideComp = linkedSideCompId ? sideCompById.get(linkedSideCompId) ?? null : null
      const sourceType: MemorySourceType = linkedSideComp ? 'SIDE_GAME' : 'GENERAL'
      return {
        momentId: m.id, roundId: m.round_id, roundOrdinal: m.round_id ? roundOrdinalById.get(m.round_id) ?? null : null,
        holeNumber: m.hole_number,
        // m.player_id null -> profiles:player_id(...) embeds as null
        // too (PostgREST's own left-join-on-null-FK behaviour) -- no
        // extra handling needed here beyond the type itself allowing it.
        playerId: m.player_id, playerName: m.profiles?.full_name ?? null,
        capturedBy: m.captured_by, capturedByName: m.captured_by ? nameByCapturedById.get(m.captured_by) ?? null : null,
        caption: m.caption, imagePath: m.image_path, imageUrl: signedUrlByPath.get(m.image_path) ?? null, audience: m.audience,
        createdAt: m.created_at, organiserFavourite: m.is_event_favourite,
        sourceType,
        sideCompId: linkedSideComp?.id ?? null,
        sideCompName: linkedSideComp ? (linkedSideComp.name || SIDE_COMP_LABEL[linkedSideComp.comp_type] || linkedSideComp.comp_type) : null,
        sideCompType: linkedSideComp?.comp_type ?? null,
        mediaType: m.moment_type, durationSeconds: m.duration_seconds, isBlooper: m.is_blooper,
        aftershowIncluded: m.aftershow_included,
      }
    }),
    sideGameWinners,
    sideGameCount: sideComps.length,
    playerCount,
    results: { champion },
  }
}
