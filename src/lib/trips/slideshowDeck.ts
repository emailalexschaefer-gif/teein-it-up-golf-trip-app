import type { EventMemoryData, MemorySourceType } from './eventMemoryData'

/**
 * Event Memories V1.2 (12 Sep) -- Event Highlights Slideshow, the
 * pure slide-ordering/chapter logic.
 *
 * PHASE 1 AUDIT FINDINGS (confirmed by reading the real code, not
 * assumed):
 *  1. Memories are ordered by created_at ASCENDING (eventMemoryData.ts).
 *     No secondary tie-break exists at the query level -- this module
 *     adds momentId as a stable secondary sort key (see
 *     sortMemoriesChronologically below), satisfying the brief's own
 *     "deterministic tie-breaking" requirement, which the raw query
 *     alone did not guarantee.
 *  2. Favourites: a single boolean, memory.organiserFavourite.
 *  3. Canonical manifest/data-fetching: fetchEventMemoryData()
 *     (eventMemoryData.ts) -- already shared by the gallery and export
 *     routes. This module takes that exact same EventMemoryData shape
 *     as its input and introduces no second, competing data model.
 *  4-6. Event/round/Side-Game metadata: all already present on
 *     EventMemoryData -- event.name/startDate/endDate, round.ordinal/
 *     name/courseName/playDate, memory.sourceType/sideCompName/
 *     holeNumber. Nothing new needed.
 *  7. Image URLs: fetchEventMemoryData's own batch-generated signed
 *     URLs (memory.imageUrl) -- reused directly; this module never
 *     fetches or generates a URL itself.
 *  8. No existing fullscreen/slideshow component exists anywhere in
 *     the app to reuse -- confirmed by searching for
 *     requestFullscreen/WakeLock and finding no matches. The gallery's
 *     own lightbox (memories/page.tsx) is a simple non-fullscreen
 *     modal, useful as a visual reference for full-bleed photo
 *     display, but not a reusable fullscreen player.
 *  9. Persistence: NOT implemented. Per the brief's own explicit
 *     preference ("if persistence requires a meaningful new schema,
 *     do not introduce it automatically... acceptable for the
 *     slideshow to be curated for the current viewing session"), this
 *     module is a pure function with no database access at all -- the
 *     curated order lives in React state for the viewing session only.
 *     A later version could persist {source, orderedMomentIds,
 *     durationSeconds} as a single additive JSONB column if genuinely
 *     wanted -- deliberately not built now, matching "do not silently
 *     add a new database model."
 * 10. Files expected to change: this new file (the pure builder), a
 *     matching test file, and the gallery page (memories/page.tsx) to
 *     add the "Produce Slideshow" entry point and the player itself --
 *     confirmed exactly matches what was built this session.
 */

export type SlideshowSource = 'favourites' | 'all' | 'selected'

/** HighlightLike mirrors makersBreakers.ts's own Highlight shape
 * (category, kind, scope, icon, title, playerId, playerName,
 * statLine, definition) -- confirmed this is exactly what
 * published_round_highlights.highlights stores, read verbatim here,
 * never regenerated. */
interface HighlightLike { kind: 'maker' | 'breaker'; icon: string; title: string; playerName: string; statLine: string }

export type Slide =
  | { kind: 'opening'; eventName: string; dateRange: string | null; heroImageUrl: string | null }
  | { kind: 'eventDivider' }
  | { kind: 'roundDivider'; roundId: string; roundName: string; courseName: string | null; playDate: string | null }
  | { kind: 'closing' }
  | {
      kind: 'photo'; momentId: string; imageUrl: string | null; caption: string | null
      roundName: string | null; holeNumber: number | null; playerName: string | null
      sourceType: MemorySourceType; sideCompName: string | null; organiserFavourite: boolean
    }
  // Official Side Game winner -- NEVER inferred from a Memory's own
  // sourceType/sideCompName. This slide is produced exclusively from
  // the authoritative sideGameWinners array (official_winner_entry_id,
  // set once by finalize_side_comp_winners()). An ordinary Side Game
  // Memory belonging to a non-winner never becomes one of these --
  // see the critical "Memory context is not a result" rule.
  | { kind: 'sideGameWinner'; sideCompId: string; label: string; holeNumber: number | null; winnerName: string; winnerImageUrl: string | null }
  // Published Makers & Breakers -- read verbatim from
  // published_round_highlights, never regenerated or recalculated here.
  | { kind: 'makersBreakers'; roundId: string; roundName: string; highlights: HighlightLike[] }
  // Event Champion -- from the authoritative standings (position 1),
  // never inferred from which player has the most photos or
  // Favourites. Absent entirely (no slide at all) when no authoritative
  // champion exists yet (event not completed).
  | { kind: 'champion'; champions: { playerId: string; playerName: string; totalPoints: number }[]; hasTie: boolean; photoUrl: string | null }
  // Final leaderboard, paginated -- `page`/`totalPages` so a large
  // field never gets squeezed onto one unreadable slide.
  | { kind: 'leaderboard'; entries: { position: number; playerName: string; totalPoints: number }[]; page: number; totalPages: number }
  // Group photo -- V1.4 (14 Sep). Only ever produced from an
  // explicit organiser selection (groupPhotoMomentId), never inferred
  // (e.g. "the Memory with the most people" -- no such detection is
  // attempted, per the brief's own explicit "do not attempt
  // unreliable AI/person-count detection"). Absent entirely if no
  // selection was made or the selected id doesn't match a real
  // Memory in this deck's own data.
  | { kind: 'groupPhoto'; momentId: string; imageUrl: string | null; caption: string | null }
  // Bloopers chapter divider -- only emitted when at least one
  // blooper clip genuinely exists, matching every other divider's
  // "no empty chapter" rule.
  | { kind: 'bloopersDivider' }
  // Blooper (short video) -- V1.4 (14 Sep), migration 086. Only ever
  // includes a Memory the organiser explicitly marked isBlooper, and
  // only ever a mediaType === 'video' Memory -- a text or photo
  // Moment can never appear here even if somehow flagged, matching
  // "the organiser selects them," not an automatic classification.
  | { kind: 'blooper'; momentId: string; videoUrl: string | null; durationSeconds: number | null; playerName: string | null; caption: string | null }
  // Round Winner -- V1.5 (15 Sep). Derived from existing round-scoped
  // scoring (eventMemoryData.ts's own round.winners, itself from
  // determineRoundWinners -- never fabricated, never conflated with
  // the overall Event Champion, which can genuinely be a different
  // player). Only ever produced for a round whose own status is
  // 'completed' -- never a mid-round snapshot.
  | { kind: 'roundResults'; roundId: string; roundName: string; winners: { playerId: string; playerName: string; points: number }[] }

export interface SlideshowDeck {
  slides: Slide[]
  memoryCount: number
}

interface MemoryLike {
  momentId: string; roundId: string | null; holeNumber: number | null
  playerName: string | null; caption: string | null; imageUrl: string | null
  createdAt: string; organiserFavourite: boolean
  sourceType: MemorySourceType; sideCompName: string | null
  // V1.4 (14 Sep) -- migration 086.
  mediaType: 'photo' | 'text' | 'video'; durationSeconds: number | null; isBlooper: boolean
}

/** Stable chronological order: created_at first, momentId as a
 * deterministic tie-break when two Memories share the exact same
 * timestamp -- the raw database query has no secondary sort key, so
 * without this, equal-timestamp Memories could reorder unpredictably
 * between runs. Never uses filename or hole number for ordering, per
 * the brief's own explicit rule (a Hole 18 photo can be captured
 * before a delayed Hole 4 upload). */
function sortMemoriesChronologically<T extends MemoryLike>(memories: T[]): T[] {
  return [...memories].sort((a, b) => {
    const byTime = a.createdAt.localeCompare(b.createdAt)
    if (byTime !== 0) return byTime
    return a.momentId.localeCompare(b.momentId)
  })
}

function formatDateRange(startDate: string | null, endDate: string | null): string | null {
  if (!startDate) return null
  const start = new Date(startDate)
  const startStr = start.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  if (!endDate || endDate === startDate) return startStr
  const end = new Date(endDate)
  const endStr = end.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  return `${startStr} \u2013 ${endStr}`
}

function selectMemories(data: EventMemoryData, source: SlideshowSource, selectedMomentIds: string[] | undefined): MemoryLike[] {
  // V1.4 (14 Sep) -- the regular photo sequence is photo Moments
  // only. A video Moment belongs exclusively in the Bloopers chapter
  // (built separately, see buildCoreSlides), never as a regular
  // photo slide -- and a text Moment has no image to show at all.
  // Filtered here, once, so every source (favourites/all/selected)
  // gets this correctly rather than needing the same check repeated
  // three times.
  const photosOnly = data.memories.filter(m => m.mediaType === 'photo')
  if (source === 'favourites') return photosOnly.filter(m => m.organiserFavourite)
  if (source === 'selected') {
    const idSet = new Set(selectedMomentIds ?? [])
    // Preserve the canonical data's own set membership -- a
    // client-supplied id that doesn't correspond to a real Memory in
    // this event is simply not present in data.memories and is
    // silently excluded, never fabricated into a slide.
    return photosOnly.filter(m => idSet.has(m.momentId))
  }
  return photosOnly
}

/**
 * buildSlideshowDeck -- the single pure function both the "choose
 * content" step and the player itself depend on. No side effects, no
 * network/database access, fully deterministic for a given input.
 *
 * Ordering, per the brief's own explicit structure: opening -> event-
 * level Memories (under a neutral "EVENT MEMORIES" divider, only if
 * any exist in the selected set) -> for each round with at least one
 * selected Memory, in chronological ordinal order: a round divider,
 * then that round's Memories chronologically -> closing. A round or
 * the event-level section with zero selected Memories produces no
 * divider at all -- no empty chapters, mirroring the export system's
 * own "no empty folders" rule.
 */
export function buildSlideshowDeck(data: EventMemoryData, source: SlideshowSource, selectedMomentIds?: string[], groupPhotoMomentId?: string): SlideshowDeck {
  const selected = selectMemories(data, source, selectedMomentIds)
  const chronological = sortMemoriesChronologically(selected)
  const slides = buildCoreSlides(data, chronological, groupPhotoMomentId)
  return { slides, memoryCount: selected.length }
}

function toPhotoSlide(m: MemoryLike, roundName: string | null): Slide {
  return {
    kind: 'photo', momentId: m.momentId, imageUrl: m.imageUrl, caption: m.caption,
    roundName, holeNumber: m.holeNumber, playerName: m.playerName,
    sourceType: m.sourceType, sideCompName: m.sideCompName, organiserFavourite: m.organiserFavourite,
  }
}

/**
 * buildCoreSlides -- shared by buildSlideshowDeck and
 * rebuildDeckFromOrder: opening -> event-level photos -> for each
 * round with at least one selected photo: round divider, that round's
 * photos, then (Event Memories V1.3, 13 Sep) its official Side Game
 * winner slides and published Makers & Breakers -- both read
 * verbatim from authoritative data, NEVER inferred from which photos
 * happen to be in this round. A round can show its winner/Makers &
 * Breakers slides even if none of its own photos were selected for
 * this slideshow (results are automatic, not tied to curation, per
 * the brief's own explicit "results should not require manual
 * curation" rule) -- so these are added per round regardless of
 * whether `roundMemories.length === 0`, unlike the round divider
 * itself, which still only appears when the round has photos OR
 * result content for it.
 *
 * Champion and Final Leaderboard appear once, after every round,
 * before the closing slide -- read from data.results.champion, which
 * is `null` for a live/incomplete event (see eventMemoryData.ts); no
 * slide is produced at all in that case, never a guessed result.
 */
function buildCoreSlides(data: EventMemoryData, chronological: MemoryLike[], groupPhotoMomentId?: string): Slide[] {
  const slides: Slide[] = []
  const firstFavourite = chronological.find(m => m.organiserFavourite)
  slides.push({
    kind: 'opening', eventName: data.event.name,
    dateRange: formatDateRange(data.event.startDate, data.event.endDate),
    heroImageUrl: firstFavourite?.imageUrl ?? null,
  })

  // Group photo (V1.4, 14 Sep) -- only ever from an explicit organiser
  // selection, looked up against the full data.memories set (not the
  // curated `chronological` photo sequence, since the group photo is
  // its own separate selection, independent of which Memories made it
  // into the main slideshow). Omitted entirely if no selection was
  // made, or the selected id doesn't match a real photo Memory in
  // this event -- never a fabricated or inferred substitute.
  if (groupPhotoMomentId) {
    const groupPhoto = data.memories.find(m => m.momentId === groupPhotoMomentId && m.mediaType === 'photo')
    if (groupPhoto) {
      slides.push({ kind: 'groupPhoto', momentId: groupPhoto.momentId, imageUrl: groupPhoto.imageUrl, caption: groupPhoto.caption })
    }
  }

  const eventLevel = chronological.filter(m => m.roundId === null)
  if (eventLevel.length > 0) {
    slides.push({ kind: 'eventDivider' })
    for (const m of eventLevel) slides.push(toPhotoSlide(m, null))
  }

  const roundsById = new Map(data.rounds.map(r => [r.id, r]))
  const roundIdsInOrdinalOrder = [...data.rounds].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)).map(r => r.id)
  const winnersByRoundId = new Map<string, EventMemoryData['sideGameWinners']>()
  for (const w of data.sideGameWinners) {
    const list = winnersByRoundId.get(w.roundId) ?? []
    list.push(w)
    winnersByRoundId.set(w.roundId, list)
  }

  for (const roundId of roundIdsInOrdinalOrder) {
    const round = roundsById.get(roundId)
    if (!round) continue
    const roundWinners = (winnersByRoundId.get(roundId) ?? []).filter(w => w.winnerPlayerId !== null && w.winnerName !== null)

    // V1.5 (15 Sep) -- Side Game duplication fix. Live testing showed
    // a winning photo appearing twice: once as an ordinary photo slide
    // (via roundMemories below, since a Side-Game-sourced Memory was
    // never excluded from the regular stream) and a second time as
    // the dedicated sideGameWinner slide, which reuses that exact same
    // photo. Root cause confirmed by reading this function's own prior
    // version: the regular photo loop and the winner-slide loop drew
    // from the same MemoryLike pool with no coordination between them.
    // Fixed by resolving every winner's matched photo FIRST (by the
    // same stable identity the winner slide itself uses -- sideCompId
    // + the official winnerPlayerId, never a display-string match),
    // then excluding those specific moment ids from the ordinary photo
    // stream -- so a winning photo is guaranteed to render exactly
    // once, via its one dedicated winner slide, never twice.
    const winnerPhotoByMomentId = new Map<string, { winner: EventMemoryData['sideGameWinners'][number]; photo: MemoryLike | undefined }>()
    for (const w of roundWinners) {
      const winnerPhoto = chronological.find(m => m.roundId === roundId && m.sideCompId === w.sideCompId && m.playerId === w.winnerPlayerId)
      if (winnerPhoto) winnerPhotoByMomentId.set(winnerPhoto.momentId, { winner: w, photo: winnerPhoto })
    }
    const roundMemories = chronological.filter(m => m.roundId === roundId && !winnerPhotoByMomentId.has(m.momentId))

    const roundHighlights = parsePublishedHighlights(round.publishedHighlights)
    // The round divider (and this round's section at all) only appears
    // when there is something real to show for it -- photos, an
    // official winner, or published Makers & Breakers. A round with
    // none of these produces no chapter at all, matching "no empty
    // chapters."
    if (roundMemories.length === 0 && roundWinners.length === 0 && roundHighlights.length === 0) continue

    slides.push({ kind: 'roundDivider', roundId: round.id, roundName: round.name, courseName: round.courseName, playDate: round.playDate })
    for (const m of roundMemories) slides.push(toPhotoSlide(m, round.name))

    for (const w of roundWinners) {
      const match = [...winnerPhotoByMomentId.values()].find(v => v.winner === w)
      slides.push({
        kind: 'sideGameWinner', sideCompId: w.sideCompId, label: w.label, holeNumber: w.holeNumber,
        winnerName: w.winnerName as string, winnerImageUrl: match?.photo?.imageUrl ?? null,
      })
    }

    if (roundHighlights.length > 0) {
      slides.push({ kind: 'makersBreakers', roundId: round.id, roundName: round.name, highlights: roundHighlights })
    }
  }

  if (data.results.champion) {
    const champ = data.results.champion
    // Champion photo: the earliest Favourite (chronologically) whose
    // playerId matches a champion -- deterministic, never AI/guessed;
    // null (an elegant card with no photo) when no such Favourite
    // exists, per the brief's own explicit rule.
    const championIds = new Set(champ.champions.map(c => c.playerId))
    const championPhoto = chronological.find(m => m.organiserFavourite && championIds.has(m.playerId))
    slides.push({ kind: 'champion', champions: champ.champions, hasTie: champ.hasTie, photoUrl: championPhoto?.imageUrl ?? null })

    const pageSize = 10
    const sorted = [...champ.standings].sort((a, b) => a.position - b.position)
    const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
    for (let page = 1; page <= totalPages; page++) {
      const entries = sorted.slice((page - 1) * pageSize, page * pageSize)
        .map(s => ({ position: s.position, playerName: s.playerName, totalPoints: s.totalPoints }))
      slides.push({ kind: 'leaderboard', entries, page, totalPages })
    }
  }

  // Bloopers/Outtakes (V1.4, 14 Sep) -- always derived from the
  // organiser's own is_blooper selection on data.memories directly,
  // never from the chronological/curated photo sequence or from the
  // chosen slideshow source (favourites/all/selected) -- Bloopers are
  // their own separate curation layer, exactly like Side Game
  // winners and Makers & Breakers are automatic results rather than
  // tied to photo curation. Only a genuine video Moment can ever
  // appear here -- a photo or text Moment flagged is_blooper (which
  // the database schema does not prevent, by design -- see migration
  // 086) is still excluded here, since the organiser's intent for
  // Bloopers is specifically short video clips, and this is the
  // layer that actually enforces that. No chapter divider or section
  // is added at all when there are zero selected Bloopers -- no
  // empty chapter, matching every other section's own rule.
  const bloopers = data.memories
    .filter(m => m.isBlooper && m.mediaType === 'video')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.momentId.localeCompare(b.momentId))
  if (bloopers.length > 0) slides.push({ kind: 'bloopersDivider' })
  for (const b of bloopers) {
    slides.push({
      kind: 'blooper', momentId: b.momentId, videoUrl: b.imageUrl,
      durationSeconds: b.durationSeconds, playerName: b.playerName, caption: b.caption,
    })
  }

  slides.push({ kind: 'closing' })
  return slides
}

/** parsePublishedHighlights -- defensive parsing of the JSON blob
 * stored in published_round_highlights.highlights. Returns [] for
 * anything that doesn't genuinely look like a Highlight[] -- never
 * throws, never fabricates a highlight from malformed/absent data. */
function parsePublishedHighlights(raw: unknown): HighlightLike[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((h): h is HighlightLike =>
    typeof h === 'object' && h !== null &&
    (h as Record<string, unknown>).kind !== undefined &&
    ((h as Record<string, unknown>).kind === 'maker' || (h as Record<string, unknown>).kind === 'breaker') &&
    typeof (h as Record<string, unknown>).playerName === 'string' &&
    typeof (h as Record<string, unknown>).title === 'string' &&
    typeof (h as Record<string, unknown>).statLine === 'string'
  )
}

/**
 * photoMomentIdsInOrder -- extracts the ordered list of photo Moment
 * ids from a deck. The curation step (Step 3 -- reorder/remove/add)
 * operates on this plain array of ids, then the player re-derives the
 * full deck (including which dividers are still needed) via
 * rebuildDeckFromOrder below -- never a second, separate "edited
 * deck" data model living alongside the original.
 */
export function photoMomentIdsInOrder(deck: SlideshowDeck): string[] {
  return deck.slides.filter((s): s is Extract<Slide, { kind: 'photo' }> => s.kind === 'photo').map(s => s.momentId)
}

/**
 * rebuildDeckFromOrder -- given a curated (possibly reordered/
 * filtered/extended) list of Moment ids, rebuilds a full deck via the
 * same buildCoreSlides logic buildSlideshowDeck uses -- results
 * (Side Game winners, Makers & Breakers, Champion, Leaderboard) are
 * never affected by curation, matching "results should not require
 * manual curation": reordering or removing photos changes which
 * Memories play, never which results appear.
 */
export function rebuildDeckFromOrder(data: EventMemoryData, orderedMomentIds: string[], groupPhotoMomentId?: string): SlideshowDeck {
  const memoryById = new Map(data.memories.map(m => [m.momentId, m]))
  const orderedMemories = orderedMomentIds
    .map(id => memoryById.get(id))
    // Defensive, matching selectMemories: the curated id list should
    // only ever contain ids that started as photo slides, but this
    // guards against a video/text Moment id ever reaching the regular
    // sequence regardless of how it got there.
    .filter((m): m is EventMemoryData['memories'][number] => m !== undefined && m.mediaType === 'photo')
  const slides = buildCoreSlides(data, orderedMemories, groupPhotoMomentId)
  return { slides, memoryCount: orderedMemories.length }
}

// =============================================================================
// V1.5 (15 Sep) -- FLEXIBLE SECTION-BASED PRESENTATION BUILDER
// =============================================================================
// Per the brief's own explicit instruction: do not redesign or rebuild
// the slideshow engine. This is a new layer ON TOP of the existing
// pure helpers above (sortMemoriesChronologically, toPhotoSlide,
// parsePublishedHighlights, formatDateRange) -- every one of them is
// called directly by buildPresentationDeck below, not reimplemented.
// buildSlideshowDeck/rebuildDeckFromOrder above are UNCHANGED in
// their own public signature and continue to work exactly as before
// (still used by the existing single-source gallery flow where a
// full section-based build isn't needed) -- this is an addition, not
// a replacement.
//
// ARCHITECTURE (brief Part 18): Presentation Section (SectionType,
// below) and Presentation Scope (PresentationScope) are now explicit,
// named concepts, not UI conditionals scattered through a component.
// buildPresentationDeck receives one PresentationConfig and
// deterministically produces the ordered Slide[] -- the exact same
// Slide union already defined above; no second slide-type system.

export type SectionType =
  | 'EVENT_OPENING' | 'GROUP_PHOTO'
  | 'ROUND_INTRO' | 'BEST_MOMENTS' | 'SIDE_GAME_WINNERS' | 'MAKERS_BREAKERS' | 'ROUND_RESULTS'
  | 'EVENT_CHAMPION' | 'FINAL_LEADERBOARD' | 'BLOOPERS' | 'EVENT_FINALE'

export type PresentationScope = { kind: 'round'; roundId: string } | { kind: 'fullEvent' }

/** Per-round section toggles. roundResults (V1.5 completion patch, 15
 * Sep) -- audited per the explicit "don't create a migration merely
 * because a round result couldn't be immediately identified" instruction,
 * and confirmed genuinely derivable WITHOUT new schema: the Round
 * Winner is the same tie-safe determineRoundWinners (multiRound.ts)
 * computeFinalResults itself already calls, fed here from a simpler,
 * round-scoped stableford_pts sum (eventMemoryData.ts), rather than
 * that function's own event-wide computation, which is gated on the
 * WHOLE event being complete and so cannot answer "who won Round 1"
 * mid-event. Only ever available for a round whose own status is
 * 'completed' (see getAvailableSections). */
export interface RoundSectionConfig {
  roundId: string
  bestMoments: boolean
  sideGameWinners: boolean
  makersBreakers: boolean
  roundResults: boolean
}

export interface PresentationConfig {
  scope: PresentationScope
  eventOpening: boolean
  groupPhoto: boolean
  /** Ordered list of included rounds with their own section toggles
   * -- for scope.kind === 'round', this must contain exactly that one
   * round; for 'fullEvent', any subset of the event's real rounds, in
   * whatever order the organiser wants them to play (normally
   * chronological, but not enforced -- the organiser's own ordering
   * choice is respected, matching "the organiser constructs the
   * presentation appropriate to that moment"). */
  rounds: RoundSectionConfig[]
  eventChampion: boolean
  finalLeaderboard: boolean
  bloopers: boolean
  eventFinale: boolean
  /** Best Moments source -- shared across every included round's
   * BEST_MOMENTS section, matching the existing, already-proven
   * favourites-first pattern rather than inventing a separate
   * selection mechanism per round. */
  bestMomentsSource: 'favourites' | 'all' | 'selected'
  selectedMomentIds?: string[]
}

/** What each section type would actually require to produce content,
 * and the human-facing label a section picker UI can use directly --
 * the single source of truth for "can this toggle even be offered"
 * (brief Part 2: "only show sections that can actually produce
 * meaningful content"). */
export interface SectionAvailability { type: SectionType; label: string; available: boolean; reason?: string }

/** getAvailableSections -- tells a picker UI which toggles to show at
 * all for a given scope, and whether each is actually available (has
 * real content) right now. A section is included in the returned list
 * either way (so the UI can show it disabled with a reason, or simply
 * filter to `available` ones -- the brief's own "only show sections
 * that can actually produce meaningful content" is satisfied by
 * filtering on `available`, while still giving a UI the option to
 * explain why something is missing rather than just omitting it
 * silently). */
export function getAvailableSections(data: EventMemoryData, scope: PresentationScope): SectionAvailability[] {
  const hasFavourite = data.memories.some(m => m.mediaType === 'photo' && m.organiserFavourite)
  const hasAnyPhoto = data.memories.some(m => m.mediaType === 'photo')
  const hasGroupPhoto = data.event.groupPhotoMomentId !== null && data.memories.some(m => m.momentId === data.event.groupPhotoMomentId && m.mediaType === 'photo')
  const hasChampion = data.results.champion !== null
  const hasBloopers = data.memories.some(m => m.mediaType === 'video' && m.isBlooper)

  function roundAvailability(roundId: string): { bestMoments: boolean; sideGameWinners: boolean; makersBreakers: boolean; roundResults: boolean } {
    const round = data.rounds.find(r => r.id === roundId)
    return {
      bestMoments: data.memories.some(m => m.roundId === roundId && m.mediaType === 'photo'),
      sideGameWinners: data.sideGameWinners.some(w => w.roundId === roundId && w.winnerPlayerId !== null && w.winnerName !== null),
      makersBreakers: parsePublishedHighlights(round?.publishedHighlights ?? null).length > 0,
      // Round Winner -- available only once the round itself is marked
      // completed AND genuinely has at least one winner computed
      // (round.winners is null for an incomplete round, [] for a
      // completed round with no scorecards at all -- neither counts).
      roundResults: (round?.winners?.length ?? 0) > 0,
    }
  }

  if (scope.kind === 'round') {
    const avail = roundAvailability(scope.roundId)
    return [
      { type: 'ROUND_INTRO', label: 'Round Intro', available: true },
      { type: 'BEST_MOMENTS', label: 'Best Moments', available: avail.bestMoments, reason: avail.bestMoments ? undefined : 'No photos for this round yet.' },
      { type: 'SIDE_GAME_WINNERS', label: 'Side Game Winners', available: avail.sideGameWinners, reason: avail.sideGameWinners ? undefined : 'No official Side Game winners for this round yet.' },
      { type: 'MAKERS_BREAKERS', label: 'Makers & Breakers', available: avail.makersBreakers, reason: avail.makersBreakers ? undefined : 'No published Makers & Breakers for this round.' },
      { type: 'ROUND_RESULTS', label: 'Round Winner', available: avail.roundResults, reason: avail.roundResults ? undefined : 'This round isn\u2019t complete yet.' },
    ]
  }

  return [
    { type: 'EVENT_OPENING', label: 'Event Opening', available: true },
    { type: 'GROUP_PHOTO', label: 'Group Photo', available: hasGroupPhoto, reason: hasGroupPhoto ? undefined : 'No Group Photo selected yet.' },
    { type: 'BEST_MOMENTS', label: 'Round Highlights', available: hasAnyPhoto, reason: hasAnyPhoto ? undefined : 'No photos yet.' },
    { type: 'SIDE_GAME_WINNERS', label: 'Side Game Winners', available: data.sideGameWinners.some(w => w.winnerPlayerId !== null) },
    { type: 'MAKERS_BREAKERS', label: 'Makers & Breakers', available: data.rounds.some(r => parsePublishedHighlights(r.publishedHighlights).length > 0) },
    { type: 'EVENT_CHAMPION', label: 'Event Champion', available: hasChampion, reason: hasChampion ? undefined : 'Event not completed yet.' },
    { type: 'FINAL_LEADERBOARD', label: 'Final Leaderboard', available: hasChampion, reason: hasChampion ? undefined : 'Event not completed yet.' },
    { type: 'BLOOPERS', label: 'Bloopers', available: hasBloopers, reason: hasBloopers ? undefined : 'No Bloopers selected yet.' },
    { type: 'EVENT_FINALE', label: "Teein' It Up Finale", available: true },
    { type: 'ROUND_INTRO', label: 'Round sections', available: data.rounds.length > 0 },
    // favourite-availability exposed for a picker that wants to warn
    // "Best Moments will be empty -- favourite some photos first,"
    // without this being a separate, undocumented side-channel.
    ...(hasAnyPhoto && !hasFavourite ? [{ type: 'BEST_MOMENTS' as SectionType, label: 'No Favourites yet', available: false, reason: 'Favourite some photos in Event Memories first, or choose All Memories.' }] : []),
  ]
}

/**
 * defaultPresentationConfig -- intelligent defaults (brief Part 5),
 * never mandatory content: every value this returns is just a normal
 * PresentationConfig the organiser can freely override before playing.
 *
 * Round scope default: Round Intro + Best Moments + Side Game Winners
 * + Makers & Breakers, but each individually only defaulted on where
 * getAvailableSections confirms real content exists -- "but only
 * where data exists" from the brief, applied literally via the same
 * availability check the picker UI itself uses, not a second,
 * separately-maintained rule.
 *
 * Full Event default: Opening + Group Photo if available + Best
 * Moments from every round (concise -- favourites only, never "all,"
 * as the default) + full section set ONLY for the LAST round
 * (chronologically) + Champion + Leaderboard + Bloopers if available
 * + Finale. Earlier rounds default to Best Moments only -- explicitly
 * NOT Side Game Winners/Makers & Breakers, per the brief's own
 * "avoid automatically replaying every Makers & Breakers selection
 * and every Side Game from every previous round... the organiser can
 * explicitly turn them on."
 */
export function defaultPresentationConfig(data: EventMemoryData, scope: PresentationScope): PresentationConfig {
  const avail = getAvailableSections(data, scope)
  const isAvail = (t: SectionType) => avail.some(a => a.type === t && a.available)

  if (scope.kind === 'round') {
    return {
      scope, eventOpening: false, groupPhoto: false,
      rounds: [{ roundId: scope.roundId, bestMoments: isAvail('BEST_MOMENTS'), sideGameWinners: isAvail('SIDE_GAME_WINNERS'), makersBreakers: isAvail('MAKERS_BREAKERS'), roundResults: isAvail('ROUND_RESULTS') }],
      eventChampion: false, finalLeaderboard: false, bloopers: false, eventFinale: false,
      bestMomentsSource: 'favourites',
    }
  }

  const roundIdsInOrder = [...data.rounds].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)).map(r => r.id)
  const lastRoundId = roundIdsInOrder[roundIdsInOrder.length - 1]
  const rounds: RoundSectionConfig[] = roundIdsInOrder.map(roundId => {
    const roundHasPhotos = data.memories.some(m => m.roundId === roundId && m.mediaType === 'photo')
    const isLastRound = roundId === lastRoundId
    const roundHasWinners = (data.rounds.find(rr => rr.id === roundId)?.winners?.length ?? 0) > 0
    return {
      roundId,
      bestMoments: roundHasPhotos,
      // Only the final round gets its results replayed by default --
      // earlier rounds' Side Games/Makers & Breakers were very likely
      // already shown on their own night, per the brief's own example.
      sideGameWinners: isLastRound && data.sideGameWinners.some(w => w.roundId === roundId && w.winnerPlayerId !== null),
      makersBreakers: isLastRound && (() => { const r = data.rounds.find(rr => rr.id === roundId); return parsePublishedHighlights(r?.publishedHighlights ?? null).length > 0 })(),
      // Round Winner follows the same "only the final round replays
      // by default" rule -- an earlier round's own winner was very
      // likely already recognised on its own night too.
      roundResults: isLastRound && roundHasWinners,
    }
  })

  return {
    scope, eventOpening: true, groupPhoto: isAvail('GROUP_PHOTO'),
    rounds,
    eventChampion: isAvail('EVENT_CHAMPION'), finalLeaderboard: isAvail('FINAL_LEADERBOARD'),
    bloopers: isAvail('BLOOPERS'), eventFinale: true,
    bestMomentsSource: 'favourites',
  }
}

function resolveBestMoments(data: EventMemoryData, roundId: string | null, config: PresentationConfig): MemoryLike[] {
  const inRound = data.memories.filter(m => m.mediaType === 'photo' && m.roundId === roundId)
  if (config.bestMomentsSource === 'favourites') return inRound.filter(m => m.organiserFavourite)
  if (config.bestMomentsSource === 'selected') {
    const idSet = new Set(config.selectedMomentIds ?? [])
    return inRound.filter(m => idSet.has(m.momentId))
  }
  return inRound
}

/**
 * buildPresentationDeck -- the new entry point for the flexible,
 * section-based builder. Deterministic: the exact same config always
 * produces the exact same deck. Reuses sortMemoriesChronologically,
 * toPhotoSlide, formatDateRange, and parsePublishedHighlights directly
 * -- every rendering decision these make (deterministic tie-breaking,
 * no invented metadata, verbatim Makers & Breakers) applies here
 * identically, not reimplemented.
 *
 * Carries the same Side Game duplication fix as buildCoreSlides above
 * (a winning photo is excluded from its round's Best Moments once
 * matched to its dedicated winner slide) -- implemented once more here
 * rather than routed through buildCoreSlides, since this function's
 * own per-round section toggles (a round might have Side Game Winners
 * OFF while Best Moments stays ON) mean the two functions' control
 * flow has genuinely diverged, not just cosmetically.
 */
export function buildPresentationDeck(data: EventMemoryData, config: PresentationConfig): SlideshowDeck {
  const slides: Slide[] = []
  let memoryCount = 0
  const roundsById = new Map(data.rounds.map(r => [r.id, r]))
  const winnersByRoundId = new Map<string, EventMemoryData['sideGameWinners']>()
  for (const w of data.sideGameWinners) {
    const list = winnersByRoundId.get(w.roundId) ?? []
    list.push(w)
    winnersByRoundId.set(w.roundId, list)
  }

  if (config.eventOpening) {
    const allFavourites = sortMemoriesChronologically(data.memories.filter(m => m.mediaType === 'photo' && m.organiserFavourite))
    slides.push({
      kind: 'opening', eventName: data.event.name,
      dateRange: formatDateRange(data.event.startDate, data.event.endDate),
      heroImageUrl: allFavourites[0]?.imageUrl ?? null,
    })
  }

  if (config.groupPhoto && data.event.groupPhotoMomentId) {
    const groupPhoto = data.memories.find(m => m.momentId === data.event.groupPhotoMomentId && m.mediaType === 'photo')
    if (groupPhoto) slides.push({ kind: 'groupPhoto', momentId: groupPhoto.momentId, imageUrl: groupPhoto.imageUrl, caption: groupPhoto.caption })
  }

  for (const roundConfig of config.rounds) {
    const round = roundsById.get(roundConfig.roundId)
    if (!round) continue // a stale/removed round id in a saved config is silently skipped, never fabricated

    const bestMoments = roundConfig.bestMoments ? sortMemoriesChronologically(resolveBestMoments(data, round.id, config)) : []
    const roundWinnersAll = roundConfig.sideGameWinners ? (winnersByRoundId.get(round.id) ?? []).filter(w => w.winnerPlayerId !== null && w.winnerName !== null) : []
    const roundHighlights = roundConfig.makersBreakers ? parsePublishedHighlights(round.publishedHighlights) : []
    const roundWinnerResult = roundConfig.roundResults ? (round.winners ?? []) : []

    if (bestMoments.length === 0 && roundWinnersAll.length === 0 && roundHighlights.length === 0 && roundWinnerResult.length === 0) continue // no empty round section

    // Duplication fix (see function-level comment): exclude any Best
    // Moments photo that is also a winner's own matched photo.
    const winnerPhotoIds = new Set<string>()
    const winnerMatches = roundWinnersAll.map(w => {
      const photo = bestMoments.find(m => m.sideCompId === w.sideCompId && m.playerId === w.winnerPlayerId)
      if (photo) winnerPhotoIds.add(photo.momentId)
      return { winner: w, photo }
    })
    const bestMomentsExcludingWinners = bestMoments.filter(m => !winnerPhotoIds.has(m.momentId))

    slides.push({ kind: 'roundDivider', roundId: round.id, roundName: round.name, courseName: round.courseName, playDate: round.playDate })
    for (const m of bestMomentsExcludingWinners) { slides.push(toPhotoSlide(m, round.name)); memoryCount += 1 }
    for (const { winner, photo } of winnerMatches) {
      slides.push({ kind: 'sideGameWinner', sideCompId: winner.sideCompId, label: winner.label, holeNumber: winner.holeNumber, winnerName: winner.winnerName as string, winnerImageUrl: photo?.imageUrl ?? null })
    }
    if (roundHighlights.length > 0) slides.push({ kind: 'makersBreakers', roundId: round.id, roundName: round.name, highlights: roundHighlights })
    if (roundWinnerResult.length > 0) slides.push({ kind: 'roundResults', roundId: round.id, roundName: round.name, winners: roundWinnerResult })
  }

  if (config.eventChampion && data.results.champion) {
    const champ = data.results.champion
    const championIds = new Set(champ.champions.map(c => c.playerId))
    const championPhoto = sortMemoriesChronologically(data.memories.filter(m => m.mediaType === 'photo' && m.organiserFavourite && championIds.has(m.playerId)))[0]
    slides.push({ kind: 'champion', champions: champ.champions, hasTie: champ.hasTie, photoUrl: championPhoto?.imageUrl ?? null })
  }

  if (config.finalLeaderboard && data.results.champion) {
    const pageSize = 10
    const sorted = [...data.results.champion.standings].sort((a, b) => a.position - b.position)
    const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
    for (let page = 1; page <= totalPages; page++) {
      const entries = sorted.slice((page - 1) * pageSize, page * pageSize).map(s => ({ position: s.position, playerName: s.playerName, totalPoints: s.totalPoints }))
      slides.push({ kind: 'leaderboard', entries, page, totalPages })
    }
  }

  if (config.bloopers) {
    const bloopers = data.memories.filter(m => m.isBlooper && m.mediaType === 'video')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.momentId.localeCompare(b.momentId))
    if (bloopers.length > 0) {
      slides.push({ kind: 'bloopersDivider' })
      for (const b of bloopers) slides.push({ kind: 'blooper', momentId: b.momentId, videoUrl: b.imageUrl, durationSeconds: b.durationSeconds, playerName: b.playerName, caption: b.caption })
    }
  }

  if (config.eventFinale) slides.push({ kind: 'closing' })

  return { slides, memoryCount }
}
