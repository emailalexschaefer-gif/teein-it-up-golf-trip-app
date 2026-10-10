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
 * never regenerated. V1.14 (8 Oct) -- roster added: makersBreakers.ts
 * already attaches a full { playerId, playerName }[] roster to every
 * GROUP highlight (playerName itself is empty for a group award,
 * which is an individual-award field), and the publish route writes
 * the request body's highlights verbatim with no field stripping --
 * so this data was already reaching the database, just never declared
 * or read here, which is why the slideshow card could only ever show
 * the group's name, never who was actually in it. undefined for an
 * individual highlight, which has no group to roster. */
/** V1.15 (9 Oct) -- scope and category added. Both are already present
 * verbatim on every real published_round_highlights row (makersBreakers.ts's
 * Highlight interface declares both, and the publish route writes the
 * request body through unchanged) -- same situation as roster above:
 * already reaching the database, just never declared or read here.
 * Needed to implement the approved brief's required presentation
 * order (individual makers -> individual breakers -> group makers ->
 * group breakers, each chronological). Optional, not required by the
 * parse filter below, so a highlight stored before this field existed
 * still renders -- it just sorts into the default "mid" phase and the
 * "individual" scope bucket, matching how it would have rendered
 * before this change. */
interface HighlightLike { kind: 'maker' | 'breaker'; icon: string; title: string; playerName: string; statLine: string; roster?: { playerId: string; playerName: string }[]; scope?: 'individual' | 'group'; category?: string }

/** CATEGORY_HOLE_PHASE -- canonical early/mid/late phase per archetype,
 * derived directly from each find*() function's own hole-range in
 * makersBreakers.ts (read exhaustively, not guessed): an archetype
 * that only inspects a round's opening holes is "early", one that only
 * inspects the back nine/final holes is "late", and anything computed
 * over the whole round (or a single hole whose position isn't fixed,
 * such as Hole from Hell or the Powerplay hole) is "mid" -- the
 * existing structural fact of which holes an archetype looks at, not
 * an invented new chronology. Categories not listed here (none
 * currently exist outside ARCHETYPE_DEFINITIONS in makersBreakers.ts)
 * default to "mid" in sortHighlightsForPresentation below. */
const CATEGORY_HOLE_PHASE: Record<string, 0 | 1 | 2> = {
  // early -- opening holes only
  hot_start: 0, cold_start: 0, still_in_car_park: 0,
  // late -- back nine / final holes only
  back_nine_king: 2, back_nine_bandits: 2, fast_finish: 2, the_closers: 2,
  rough_finish: 2, wheels_off: 2, back_nine_breakdown: 2, one_that_got_away: 2,
  // mid -- whole-round or a variable/unfixed single hole (the_collapse's
  // own definition text literally calls it "a real mid-round unravelling")
  the_collapse: 1,
}

function highlightPhase(category: string | undefined): 0 | 1 | 2 {
  return (category && CATEGORY_HOLE_PHASE[category] !== undefined) ? CATEGORY_HOLE_PHASE[category] : 1
}

/** sortHighlightsForPresentation -- the approved brief's required
 * order: within a round, Individual Makers, then Individual Breakers,
 * then Group Makers, then Group Breakers, each group internally
 * chronological (early to late holes). A stable sort (guaranteed by
 * Array.prototype.sort since ES2019) means highlights that land in the
 * same bucket and the same phase keep their original relative order --
 * which is generateMakersAndBreakers's own significance-descending
 * order, so the strongest candidate within a tied phase still leads.
 * No badge-awarding rule is touched here -- this only reorders
 * already-qualified, already-published highlights for display. */
function sortHighlightsForPresentation(highlights: HighlightLike[]): HighlightLike[] {
  const bucketRank = (h: HighlightLike): number => {
    const scope = h.scope ?? 'individual'
    if (scope === 'individual' && h.kind === 'maker') return 0
    if (scope === 'individual' && h.kind === 'breaker') return 1
    if (scope === 'group' && h.kind === 'maker') return 2
    return 3 // group breaker
  }
  return [...highlights].sort((a, b) => {
    const bucketDiff = bucketRank(a) - bucketRank(b)
    if (bucketDiff !== 0) return bucketDiff
    return highlightPhase(a.category) - highlightPhase(b.category)
  })
}

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
  // V1.6 (5 Oct) -- fixed a real bug: all of a round's Makers &
  // Breakers used to be crammed into one grid slide with
  // overflowY:'auto' -- the same "content gets visually clipped on a
  // fixed presentation screen" bug class already fixed for the
  // Leaderboard, here causing the reported "title shows, nothing
  // meaningful follows." Split into a lightweight title divider plus
  // one full slide per highlight -- structurally impossible to
  // overflow (a single card always fits), and each card can now carry
  // its own matched photo where one genuinely exists.
  | { kind: 'makersBreakersDivider'; roundId: string; roundName: string }
  // V1.7 (6 Oct) -- photoUrl removed entirely, per an explicit product
  // correction from live testing: the display-name photo matching
  // (never a stable identity, since published_round_highlights only
  // ever stores a display name) produced genuinely wrong results in
  // practice -- a generic group photo was shown as "The Mailman"'s
  // own photo. Makers & Breakers is the generated story, not an
  // approximate-photo lookup; every card now always uses the standard
  // premium background treatment, with no photo, ever.
  | { kind: 'makersBreakersCard'; highlight: HighlightLike }
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
  // Event-at-a-Glance -- V1.7 (6 Oct). Dynamic, never baked into an
  // artwork; every number and name comes from real event data.
  // courseNames is in chronological round order (one entry per round
  // that genuinely has a course name set -- a round without one is
  // simply omitted from the list, never shown as a blank line).
  // sideGameCount reflects every Side Game configured for the event,
  // not just finalized winners. V1.17 (10 Oct) -- championCount added,
  // replacing a hardcoded "1" in the renderer: the real count of
  // confirmed champions from data.results.champion.champions (the
  // SAME authoritative countback computeFinalResults/the Champion
  // slide itself already use) -- 0 for an event with no confirmed
  // champion yet, 1 for a sole winner, 2+ for a genuine tie. Never
  // fabricated and never silently collapsed to 1 when there's a tie.
  | { kind: 'eventAtAGlance'; roundCount: number; courseNames: string[]; totalHoles: number; sideGameCount: number; championCount: number }
  // Bloopers chapter divider -- only emitted when at least one
  // blooper clip genuinely exists, matching every other divider's
  // "no empty chapter" rule.
  | { kind: 'bloopersDivider' }
  // Blooper (short video) -- V1.4 (14 Sep), migration 086. Only ever
  // includes a Memory the organiser explicitly marked isBlooper, and
  // only ever a mediaType === 'video' Memory -- a text or photo
  // Moment can never appear here even if somehow flagged, matching
  // "the organiser selects them," not an automatic classification.
  // V1.6 (5 Oct) -- media type and storytelling classification are
  // independent (migration 090): a Blooper can now be a photo as
  // honestly as a video. mediaType tells the player which way to
  // render it; durationSeconds is only ever meaningful for video.
  | { kind: 'blooper'; momentId: string; mediaType: 'photo' | 'video'; imageUrl: string | null; durationSeconds: number | null; playerName: string | null; caption: string | null }
  // Round Winner -- V1.5 (15 Sep). Derived from existing round-scoped
  // scoring (eventMemoryData.ts's own round.winners, itself from
  // determineRoundWinners -- never fabricated, never conflated with
  // the overall Event Champion, which can genuinely be a different
  // player). Only ever produced for a round whose own status is
  // 'completed' -- never a mid-round snapshot.
  // V1.7 (6 Oct) -- photoUrl added: a Round Winner photo, matched by
  // playerId against that round's own photos (the winner's own
  // Favourite photo in that round, if one exists) -- never guessed,
  // null when none exists.
  // V1.14 (8 Oct) -- replaced the photo-led Round Winner card with a
  // round-specific Top-5 standings slide, per explicit product
  // correction: "do not require a Round Winner photograph; do not use
  // Group Photo as a Round Winner fallback." standings is this round's
  // own ranked results only (never cumulative), from
  // determineRoundStandings -- position 1 is this round's winner,
  // displayed distinctly by the renderer, never a separate field here.
  | { kind: 'roundResults'; roundId: string; roundName: string; standings: { playerId: string; playerName: string; roundPoints: number; position: number }[] }

export interface SlideshowDeck {
  slides: Slide[]
  memoryCount: number
  /** V1.18 (10 Oct), Package 5. Index within `slides` of the first
   * Moments & Bloopers aftershow slide (its chapter divider) --
   * undefined when the aftershow has no eligible media, so playback
   * correctly ends on the closing screen with no empty chapter.
   * EventHighlightsPlayer loops playback back to this index when it
   * reaches the end of the deck, instead of stopping -- "only Moments
   * & Bloopers should repeat... the formal presentation plays once." */
  aftershowStartIndex?: number
  /** Whether the aftershow should loop at all once reached. Defaults
   * to true (Package 5.2's own default settings table: "Repeat
   * aftershow = ON") -- an organiser can turn it off via
   * PresentationConfig.aftershowLoop. Always true for the legacy
   * buildSlideshowDeck path, which has no config object to read a
   * preference from. */
  aftershowLoop?: boolean
}

interface MemoryLike {
  momentId: string; roundId: string | null; holeNumber: number | null
  playerName: string | null; caption: string | null; imageUrl: string | null
  createdAt: string; organiserFavourite: boolean
  sourceType: MemorySourceType; sideCompName: string | null
  // V1.4 (14 Sep) -- migration 086.
  mediaType: 'photo' | 'text' | 'video'; durationSeconds: number | null; isBlooper: boolean
  // V1.18 (10 Oct), migration 095 -- playerId null means an organiser-
  // uploaded, event-level Moment with no identifiable subject (Package
  // 2's "Upload Moments"); this is exactly what makes a Moment
  // eligible for the aftershow's "unassigned event-level upload"
  // auto-suggestion rule in resolveAftershowMomentIds below.
  // aftershowIncluded is the organiser's own explicit override for
  // that same resolution -- see the same function.
  playerId: string | null; aftershowIncluded: boolean | null
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
  const { slides, aftershowStartIndex } = buildCoreSlides(data, chronological, groupPhotoMomentId)
  return { slides, memoryCount: selected.length, aftershowStartIndex, aftershowLoop: true }
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
function buildCoreSlides(data: EventMemoryData, chronological: MemoryLike[], groupPhotoMomentId?: string): { slides: Slide[]; aftershowStartIndex?: number } {
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
    // V1.9 (6 Oct) -- winnerPlayerId alone, matching the fix above.
    const roundWinners = (winnersByRoundId.get(roundId) ?? []).filter(w => w.winnerPlayerId !== null)

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
      slides.push({ kind: 'makersBreakersDivider', roundId: round.id, roundName: round.name })
      // V1.7 (6 Oct) -- photo matching removed entirely (see the
      // Slide type's own comment for the full reasoning). Every card
      // uses the standard premium background treatment now.
      for (const h of roundHighlights) slides.push({ kind: 'makersBreakersCard', highlight: h })
    }
  }

  if (data.results.champion) {
    const champ = data.results.champion
    // Champion photo: the earliest Favourite (chronologically) whose
    // V1.6 (5 Oct) -- full priority chain, per the brief: (1) an
    // explicit organiser-selected Champion Photo always wins; (2)
    // otherwise a Favourite photo of the champion player, matched by
    // playerId -- deterministic, never AI/guessed; (3) only if neither
    // exists does the card render with no photo at all. V1.14 (8 Oct)
    // -- the Group Photo fallback previously here has been removed;
    // see the identical fix in buildPresentationDeck above for the
    // full root-cause explanation (an automatic duplication the
    // organiser never chose, not a deliberate re-selection).
    const championIds = new Set(champ.champions.map(c => c.playerId))
    const explicitChampionPhoto = data.event.championPhotoMomentId
      ? data.memories.find(m => m.momentId === data.event.championPhotoMomentId && m.mediaType === 'photo')
      : undefined
    const favouriteChampionPhoto = chronological.find(m => m.organiserFavourite && championIds.has(m.playerId))
    const championPhotoUrl = explicitChampionPhoto?.imageUrl ?? favouriteChampionPhoto?.imageUrl ?? null
    slides.push({ kind: 'champion', champions: champ.champions, hasTie: champ.hasTie, photoUrl: championPhotoUrl })

    // V1.6 (5 Oct) -- redesigned from paginated Top 10 to a single
    // Top-5 celebration slide, per the brief: players have already
    // followed the live leaderboard throughout the event, so this
    // slide's job is to celebrate the leading finishers, not
    // reproduce the full field. Always exactly one slide now -- never
    // multiple pages. Fewer than 5 players simply shows however many
    // exist (slice never pads with fabricated entries).
    const sorted = [...champ.standings].sort((a, b) => a.position - b.position)
    const entries = sorted.slice(0, 5).map(s => ({ position: s.position, playerName: s.playerName, totalPoints: s.totalPoints }))
    slides.push({ kind: 'leaderboard', entries, page: 1, totalPages: 1 })
  }

  // V1.18 (10 Oct), Package 5 -- the closing screen now comes BEFORE
  // the Moments & Bloopers aftershow, not after: "Closing Screen ->
  // Moments & Bloopers (automatic looping aftershow)." The formal
  // presentation (everything up to and including this slide) plays
  // exactly once; only what follows it ever loops.
  slides.push({ kind: 'closing' })

  // Moments & Bloopers aftershow (V1.4, 14 Sep; renamed and widened
  // V1.18, 10 Oct, Package 4) -- its member set is now resolved by
  // resolveAftershowMomentIds, the single canonical resolver also used
  // by the organiser's own picker UI (Package 4.3's explicit "reuse
  // the existing selection architecture" requirement), rather than a
  // plain is_blooper filter duplicated here. See that function for the
  // full suggestion/override contract. No chapter divider or section
  // is added at all when there are zero included Moments -- no empty
  // chapter, matching every other section's own rule, and matching
  // Package 5's explicit "if no aftershow media is selected, the
  // slideshow should end normally on the closing screen."
  const aftershowIds = resolveAftershowMomentIds(data)
  const bloopers = data.memories
    .filter(m => aftershowIds.has(m.momentId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.momentId.localeCompare(b.momentId))
  let aftershowStartIndex: number | undefined
  if (bloopers.length > 0) {
    aftershowStartIndex = slides.length
    slides.push({ kind: 'bloopersDivider' })
    for (const b of bloopers) {
      slides.push({
        kind: 'blooper', momentId: b.momentId, mediaType: b.mediaType as 'photo' | 'video', imageUrl: b.imageUrl,
        durationSeconds: b.durationSeconds, playerName: b.playerName, caption: b.caption,
      })
    }
  }

  return { slides, aftershowStartIndex }
}

/** parsePublishedHighlights -- defensive parsing of the JSON blob
 * stored in published_round_highlights.highlights. Returns [] for
 * anything that doesn't genuinely look like a Highlight[] -- never
 * throws, never fabricates a highlight from malformed/absent data.
 * V1.15 (9 Oct) -- now also applies sortHighlightsForPresentation
 * before returning, so both call sites (buildCoreSlides and
 * buildPresentationDeck) get the approved presentation order from
 * this single place, rather than each needing to sort separately. */
function parsePublishedHighlights(raw: unknown): HighlightLike[] {
  if (!Array.isArray(raw)) return []
  const parsed = raw.filter((h): h is HighlightLike =>
    typeof h === 'object' && h !== null &&
    (h as Record<string, unknown>).kind !== undefined &&
    ((h as Record<string, unknown>).kind === 'maker' || (h as Record<string, unknown>).kind === 'breaker') &&
    typeof (h as Record<string, unknown>).playerName === 'string' &&
    typeof (h as Record<string, unknown>).title === 'string' &&
    typeof (h as Record<string, unknown>).statLine === 'string'
  )
  return sortHighlightsForPresentation(parsed)
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
  const { slides, aftershowStartIndex } = buildCoreSlides(data, orderedMemories, groupPhotoMomentId)
  return { slides, memoryCount: orderedMemories.length, aftershowStartIndex, aftershowLoop: true }
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
  | 'EVENT_OPENING' | 'EVENT_AT_A_GLANCE' | 'GROUP_PHOTO'
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
  // V1.7 (6 Oct) -- Event-at-a-Glance. Full Event only (never
  // meaningful for a single-round presentation, which already knows
  // its own scope); sits between Event Opening and Group Photo.
  eventAtAGlance: boolean
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
  // V1.18 (10 Oct), Package 5.2 -- "Repeat aftershow = ON" is the
  // stated default; optional (not required on every config literal)
  // so existing hand-built PresentationConfig objects (tests, saved
  // configs from before this field existed) keep working unchanged --
  // treated as true wherever it's actually read, matching the brief's
  // own stated default rather than an unset toggle silently meaning off.
  aftershowLoop?: boolean
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
  // V1.18 (10 Oct), Package 4 -- availability now reflects the full
  // resolved aftershow set (Blooper-tagged + unassigned event-level
  // uploads + any explicit organiser inclusion), not just a plain
  // is_blooper video filter.
  const hasBloopers = resolveAftershowMomentIds(data).size > 0

  function roundAvailability(roundId: string): { bestMoments: boolean; sideGameWinners: boolean; makersBreakers: boolean; roundResults: boolean } {
    const round = data.rounds.find(r => r.id === roundId)
    return {
      bestMoments: data.memories.some(m => m.roundId === roundId && m.mediaType === 'photo'),
      // V1.9 (6 Oct) -- winnerPlayerId alone is the authoritative
      // winner determination (official_winner_entry_id -> player);
      // winnerName is now guaranteed non-null whenever winnerPlayerId
      // is (see eventMemoryData.ts's own fix), so checking both here
      // was redundant and had quietly drifted from
      // defaultPresentationConfig's own simpler check below -- fixed
      // to the same single condition everywhere this is checked.
      sideGameWinners: data.sideGameWinners.some(w => w.roundId === roundId && w.winnerPlayerId !== null),
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
    { type: 'EVENT_AT_A_GLANCE', label: 'Event-at-a-Glance', available: data.rounds.length > 0, reason: data.rounds.length > 0 ? undefined : 'No rounds yet.' },
    { type: 'GROUP_PHOTO', label: 'Group Photo', available: hasGroupPhoto, reason: hasGroupPhoto ? undefined : 'No Group Photo selected yet.' },
    { type: 'BEST_MOMENTS', label: 'Round Highlights', available: hasAnyPhoto, reason: hasAnyPhoto ? undefined : 'No photos yet.' },
    { type: 'SIDE_GAME_WINNERS', label: 'Side Game Winners', available: data.sideGameWinners.some(w => w.winnerPlayerId !== null) },
    { type: 'MAKERS_BREAKERS', label: 'Makers & Breakers', available: data.rounds.some(r => parsePublishedHighlights(r.publishedHighlights).length > 0) },
    { type: 'EVENT_CHAMPION', label: 'Event Champion', available: hasChampion, reason: hasChampion ? undefined : 'Event not completed yet.' },
    { type: 'FINAL_LEADERBOARD', label: 'Final Leaderboard', available: hasChampion, reason: hasChampion ? undefined : 'Event not completed yet.' },
    { type: 'BLOOPERS', label: 'Moments & Bloopers', available: hasBloopers, reason: hasBloopers ? undefined : 'No Moments or Bloopers to include yet.' },
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
      scope, eventOpening: false, eventAtAGlance: false, groupPhoto: false,
      rounds: [{ roundId: scope.roundId, bestMoments: isAvail('BEST_MOMENTS'), sideGameWinners: isAvail('SIDE_GAME_WINNERS'), makersBreakers: isAvail('MAKERS_BREAKERS'), roundResults: isAvail('ROUND_RESULTS') }],
      eventChampion: false, finalLeaderboard: false, bloopers: false, aftershowLoop: true, eventFinale: false,
      bestMomentsSource: 'favourites',
    }
  }

  const roundIdsInOrder = [...data.rounds].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)).map(r => r.id)
  const rounds: RoundSectionConfig[] = roundIdsInOrder.map(roundId => {
    const roundHasPhotos = data.memories.some(m => m.roundId === roundId && m.mediaType === 'photo')
    const roundHasWinners = (data.rounds.find(rr => rr.id === roundId)?.winners?.length ?? 0) > 0
    return {
      roundId,
      bestMoments: roundHasPhotos,
      // V1.7 (6 Oct) -- regression fix, per direct live-testing
      // correction: every round's Side Game Winners/Makers &
      // Breakers/Round Winner now defaults ON whenever that round
      // genuinely has the content available, derived independently
      // per round via the same getAvailableSections-style checks used
      // everywhere else -- no round is treated differently from any
      // other. This replaces the prior "only the final round replays
      // by default" rule, which a real device test showed left Round
      // 1's own genuinely-available Side Game Winners defaulting off
      // -- confirmed as the wrong default, not a data gap, since the
      // availability check itself (which correctly offered the
      // toggle) and the default (which left it off) had quietly
      // diverged into two different rules for the same question.
      sideGameWinners: data.sideGameWinners.some(w => w.roundId === roundId && w.winnerPlayerId !== null),
      makersBreakers: (() => { const r = data.rounds.find(rr => rr.id === roundId); return parsePublishedHighlights(r?.publishedHighlights ?? null).length > 0 })(),
      roundResults: roundHasWinners,
    }
  })

  return {
    scope, eventOpening: true, eventAtAGlance: isAvail('EVENT_AT_A_GLANCE'), groupPhoto: isAvail('GROUP_PHOTO'),
    rounds,
    eventChampion: isAvail('EVENT_CHAMPION'), finalLeaderboard: isAvail('FINAL_LEADERBOARD'),
    bloopers: isAvail('BLOOPERS'), aftershowLoop: true, eventFinale: true,
    bestMomentsSource: 'favourites',
  }
}

/**
 * resolveSelectedMomentIds -- V1.9 (6 Oct), the single canonical
 * resolver for "which photo Moments does Best Moments actually
 * include," across every round the config has toggled on. Built
 * specifically because a real-device audit traced the "0 photos, but
 * thumbnails visible" symptom to there being no single source of
 * truth: the Review screen's thumbnail grid independently computed
 * "every eligible photo in the included rounds" (regardless of
 * Favourite status or source mode), while the deck builder separately
 * resolved the actual included set per round via its own filtering --
 * the two could show a different count than what the grid implied was
 * available, with nothing forcing them to agree. This function is now
 * the one place that logic lives; both buildPresentationDeck (via
 * resolveBestMoments below, which now only adds the per-round split)
 * and the UI's own preview/thumbnail grid call this directly.
 *
 * Required invariant, confirmed by this function's own contract:
 *   'favourites' -> exactly every eligible Favourite photo in the
 *     included rounds, nothing added or removed by any other state.
 *   'all'        -> exactly every eligible photo in the included
 *     rounds -- selectedMomentIds is never consulted and can never
 *     shrink this set.
 *   'selected'   -> exactly the explicitly selected ids that are
 *     still eligible (a stale id for a since-removed round or Moment
 *     is silently excluded, never kept).
 */
export function resolveSelectedMomentIds(data: EventMemoryData, config: PresentationConfig): Set<string> {
  const eligibleRoundIds = new Set(config.rounds.filter(r => r.bestMoments).map(r => r.roundId))
  const eligible = data.memories.filter(m => m.mediaType === 'photo' && eligibleRoundIds.has(m.roundId ?? ''))
  if (config.bestMomentsSource === 'favourites') return new Set(eligible.filter(m => m.organiserFavourite).map(m => m.momentId))
  if (config.bestMomentsSource === 'selected') {
    const requested = new Set(config.selectedMomentIds ?? [])
    return new Set(eligible.filter(m => requested.has(m.momentId)).map(m => m.momentId))
  }
  return new Set(eligible.map(m => m.momentId))
}

/**
 * resolveAftershowMomentIds -- V1.18 (10 Oct), Package 4.3's explicit
 * "reuse the existing Moments-selection architecture" requirement,
 * applied to the aftershow exactly as resolveSelectedMomentIds (above)
 * is applied to Best Moments: one canonical function, called by both
 * the deck builder and the organiser's own picker UI, so the two can
 * never disagree about what the aftershow actually contains.
 *
 * Eligible media: every photo or video Moment (never text -- no
 * visual content to show in this chapter), independent of which
 * rounds are included in this particular presentation (the aftershow
 * is explicitly "a relaxed collection of memories," not scoped to the
 * same rounds as the formal presentation, per the brief's own Package 6).
 *
 * For a Moment with no explicit organiser decision yet
 * (aftershowIncluded === null -- the default for every Moment,
 * including a brand new upload), the AUTOMATIC SUGGESTION applies:
 * included when it's flagged isBlooper, OR it's an unassigned
 * event-level upload (playerId === null) -- Package 4's "all eligible
 * Blooper-tagged Moments, and all eligible event-level media uploaded
 * by the organiser without a round assignment ... both sets initially
 * pre-selected."
 *
 * For a Moment the organiser HAS explicitly decided
 * (aftershowIncluded === true or false), that decision always wins,
 * regardless of the suggestion rule above. This is the single most
 * important behaviour this function exists to guarantee -- the
 * brief's own most heavily flagged requirement: "once the organiser
 * manually changes the selection, preserve those decisions. Do not
 * silently reselect previously excluded Moments when the slideshow
 * builder refreshes. New uploads may be suggested, but existing
 * manual exclusions must remain respected." A fresh upload has
 * aftershowIncluded still null (it's never been decided), so it is
 * correctly suggested by the rule above without ever touching any
 * other Moment's own, already-persisted explicit decision.
 */
export function resolveAftershowMomentIds(data: EventMemoryData): Set<string> {
  const eligible = data.memories.filter(m => m.mediaType === 'photo' || m.mediaType === 'video')
  const included = eligible.filter(m => {
    // == null (not ===) deliberately catches both null and undefined --
    // every real row from eventMemoryData.ts is always null or a real
    // boolean, never undefined, but this keeps the function robust
    // against any caller (including a test fixture) that simply omits
    // the field rather than setting it to null explicitly.
    if (m.aftershowIncluded == null) return m.isBlooper || m.playerId === null
    return m.aftershowIncluded
  })
  return new Set(included.map(m => m.momentId))
}

function resolveBestMoments(data: EventMemoryData, roundId: string | null, config: PresentationConfig): MemoryLike[] {
  const includedIds = resolveSelectedMomentIds(data, config)
  return data.memories.filter(m => m.mediaType === 'photo' && m.roundId === roundId && includedIds.has(m.momentId))
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

  // V1.17 (10 Oct) -- defensive scope guard added: Event-at-a-Glance
  // summarises the WHOLE event (every round in data.rounds), by
  // design, matching how Opening/Group Photo are also always event-
  // level regardless of which rounds this particular presentation
  // includes -- this is documented, existing behaviour, not changed
  // here (see the delivery report for the full reasoning). What IS
  // new is this explicit `config.scope.kind === 'fullEvent'` check:
  // defaultPresentationConfig already hardcodes eventAtAGlance=false
  // for a round-scoped presentation and no UI ever exposes this
  // section's toggle in round scope, so this was never reachable in
  // practice -- but the builder itself previously had no structural
  // guarantee against it, only the UI's own convention. This closes
  // that gap so a round-scoped presentation can never show whole-event
  // statistics, even if a future config path set the flag true.
  if (config.eventAtAGlance && config.scope.kind === 'fullEvent' && data.rounds.length > 0) {
    const roundsInOrder = [...data.rounds].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))
    const courseNames = roundsInOrder.map(r => r.courseName).filter((n): n is string => n !== null && n.length > 0)
    const totalHoles = roundsInOrder.reduce((sum, r) => sum + r.holes, 0)
    // V1.17 (10 Oct) -- championCount from the exact same authoritative
    // result the Champion slide itself uses (data.results.champion,
    // computeFinalResults' own countback) -- never a separate
    // calculation. 0 when the event isn't completed/has no confirmed
    // champion yet; genuinely reflects a tie (2+) rather than
    // collapsing it to 1.
    const championCount = data.results.champion?.champions.length ?? 0
    slides.push({
      kind: 'eventAtAGlance', roundCount: roundsInOrder.length, courseNames,
      totalHoles, sideGameCount: data.sideGameCount, championCount,
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
    // V1.9 (6 Oct) -- winnerPlayerId alone, matching the fix above.
    const roundWinnersAll = roundConfig.sideGameWinners ? (winnersByRoundId.get(round.id) ?? []).filter(w => w.winnerPlayerId !== null) : []
    const roundHighlights = roundConfig.makersBreakers ? parsePublishedHighlights(round.publishedHighlights) : []
    // V1.14 (8 Oct) -- standings (this round's own ranked Top-5), not
    // winners alone -- winners is still used elsewhere (Priority
    // 9/Event Champion context is untouched; this variable only feeds
    // the Round Results slide below).
    const roundStandingsResult = roundConfig.roundResults ? (round.standings ?? []) : []

    if (bestMoments.length === 0 && roundWinnersAll.length === 0 && roundHighlights.length === 0 && roundStandingsResult.length === 0) continue // no empty round section

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
    if (roundHighlights.length > 0) {
      slides.push({ kind: 'makersBreakersDivider', roundId: round.id, roundName: round.name })
      // V1.7 (6 Oct) -- photo matching removed entirely, per the
      // explicit product correction (see the Slide type's own
      // comment). Every card uses the standard premium background now.
      for (const h of roundHighlights) slides.push({ kind: 'makersBreakersCard', highlight: h })
    }
    // V1.14 (8 Oct) -- no photo matching at all now, per the explicit
    // "do not require a Round Winner photograph; do not use Group
    // Photo as a Round Winner fallback" instruction. The generic
    // template owns this slide's presentation entirely.
    if (roundStandingsResult.length > 0) {
      slides.push({ kind: 'roundResults', roundId: round.id, roundName: round.name, standings: roundStandingsResult })
    }
  }

  if (config.eventChampion && data.results.champion) {
    const champ = data.results.champion
    // V1.6 (5 Oct) -- same priority chain as buildCoreSlides above:
    // explicit Champion Photo, then a Favourite photo of the
    // champion, then no photo (a clean card). V1.14 (8 Oct) -- the
    // Group Photo fallback step that previously sat here has been
    // removed entirely. Root cause, confirmed by a real-device report
    // of "the original Group Photo appearing again after Round 3
    // content": the Champion slide always comes after every round, so
    // whenever no explicit Champion Photo and no Favourite photo of
    // the champion existed, this fallback silently reused the exact
    // same image already shown as its own dedicated Group Photo slide
    // earlier in the deck -- an automatic duplication the organiser
    // never chose, not a deliberate re-selection of that Moment. The
    // organiser can still legitimately see the Group Photo's own
    // image again if they explicitly mark that Moment a Favourite
    // (it would then surface here via favouriteChampionPhoto, exactly
    // as any other Favourite of the champion would) -- that remains
    // an intentional choice, not automatic duplication.
    const championIds = new Set(champ.champions.map(c => c.playerId))
    const explicitChampionPhoto = data.event.championPhotoMomentId
      ? data.memories.find(m => m.momentId === data.event.championPhotoMomentId && m.mediaType === 'photo')
      : undefined
    const favouriteChampionPhoto = sortMemoriesChronologically(data.memories.filter(m => m.mediaType === 'photo' && m.organiserFavourite && championIds.has(m.playerId)))[0]
    const championPhotoUrl = explicitChampionPhoto?.imageUrl ?? favouriteChampionPhoto?.imageUrl ?? null
    slides.push({ kind: 'champion', champions: champ.champions, hasTie: champ.hasTie, photoUrl: championPhotoUrl })
  }

  if (config.finalLeaderboard && data.results.champion) {
    // V1.6 (5 Oct) -- Top 5 only, a single slide, matching buildCoreSlides above.
    const sorted = [...data.results.champion.standings].sort((a, b) => a.position - b.position)
    const entries = sorted.slice(0, 5).map(s => ({ position: s.position, playerName: s.playerName, totalPoints: s.totalPoints }))
    slides.push({ kind: 'leaderboard', entries, page: 1, totalPages: 1 })
  }

  // V1.18 (10 Oct), Package 5 -- the closing screen now comes BEFORE
  // the Moments & Bloopers aftershow (see buildCoreSlides' identical
  // reordering above for the full reasoning): "Closing Screen ->
  // Moments & Bloopers (automatic looping aftershow)." The formal
  // presentation plays exactly once; only the aftershow chapter loops.
  if (config.eventFinale) slides.push({ kind: 'closing' })

  // Moments & Bloopers aftershow (renamed/widened V1.18, Package 4) --
  // resolved by resolveAftershowMomentIds, the same canonical resolver
  // the organiser's own picker UI uses (Package 4.3), not a plain
  // is_blooper filter duplicated here. config.bloopers remains the
  // existing "include this chapter at all" toggle, unchanged in
  // meaning. aftershowStartIndex/aftershowLoop are only ever set when
  // the chapter genuinely has content -- an empty aftershow produces
  // no divider and no loop point, so playback correctly ends on the
  // closing screen (Package 5: "if no aftershow media is selected,
  // the slideshow should end normally on the closing screen").
  let aftershowStartIndex: number | undefined
  if (config.bloopers) {
    const aftershowIds = resolveAftershowMomentIds(data)
    const bloopers = data.memories.filter(m => aftershowIds.has(m.momentId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.momentId.localeCompare(b.momentId))
    if (bloopers.length > 0) {
      aftershowStartIndex = slides.length
      slides.push({ kind: 'bloopersDivider' })
      for (const b of bloopers) slides.push({ kind: 'blooper', momentId: b.momentId, mediaType: b.mediaType as 'photo' | 'video', imageUrl: b.imageUrl, durationSeconds: b.durationSeconds, playerName: b.playerName, caption: b.caption })
    }
  }

  return { slides, memoryCount, aftershowStartIndex, aftershowLoop: config.aftershowLoop ?? true }
}
