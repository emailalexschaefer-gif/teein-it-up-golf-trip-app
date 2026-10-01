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

export interface SlideshowDeck {
  slides: Slide[]
  memoryCount: number
}

interface MemoryLike {
  momentId: string; roundId: string | null; holeNumber: number | null
  playerName: string | null; caption: string | null; imageUrl: string | null
  createdAt: string; organiserFavourite: boolean
  sourceType: MemorySourceType; sideCompName: string | null
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
  if (source === 'favourites') return data.memories.filter(m => m.organiserFavourite)
  if (source === 'selected') {
    const idSet = new Set(selectedMomentIds ?? [])
    // Preserve the canonical data's own set membership -- a
    // client-supplied id that doesn't correspond to a real Memory in
    // this event is simply not present in data.memories and is
    // silently excluded, never fabricated into a slide.
    return data.memories.filter(m => idSet.has(m.momentId))
  }
  return data.memories
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
export function buildSlideshowDeck(data: EventMemoryData, source: SlideshowSource, selectedMomentIds?: string[]): SlideshowDeck {
  const selected = selectMemories(data, source, selectedMomentIds)
  const slides: Slide[] = []

  // Opening. Hero image: deterministic, not AI-chosen -- the first
  // Favourite in final chronological order if one exists among the
  // selected set, else null (clean event branding, no guess at "the
  // best photo"). This is a plain, explainable rule, not a heuristic
  // that could look like it "picked" a favourite scene.
  const chronological = sortMemoriesChronologically(selected)
  const firstFavourite = chronological.find(m => m.organiserFavourite)
  slides.push({
    kind: 'opening',
    eventName: data.event.name,
    dateRange: formatDateRange(data.event.startDate, data.event.endDate),
    heroImageUrl: firstFavourite?.imageUrl ?? null,
  })

  const eventLevel = chronological.filter(m => m.roundId === null)
  if (eventLevel.length > 0) {
    slides.push({ kind: 'eventDivider' })
    for (const m of eventLevel) slides.push(toPhotoSlide(m, null))
  }

  const roundsById = new Map(data.rounds.map(r => [r.id, r]))
  const roundIdsInOrdinalOrder = [...data.rounds]
    .sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))
    .map(r => r.id)

  for (const roundId of roundIdsInOrdinalOrder) {
    const roundMemories = chronological.filter(m => m.roundId === roundId)
    if (roundMemories.length === 0) continue // no empty round chapters
    const round = roundsById.get(roundId)
    if (!round) continue // defensive: a memory referencing a round not in this data set is never surfaced
    slides.push({
      kind: 'roundDivider', roundId: round.id, roundName: round.name,
      courseName: round.courseName, playDate: round.playDate,
    })
    for (const m of roundMemories) slides.push(toPhotoSlide(m, round.name))
  }

  slides.push({ kind: 'closing' })

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
 * filtered/extended) list of Moment ids, rebuilds a full deck:
 * opening, dividers only where that section still has at least one
 * photo in the curated order, and closing. Round dividers follow the
 * ROUND's own chronological ordinal position, not the order the
 * organiser happened to drag photos into -- a photo moved to sit
 * after a different round's photos is still grouped under its own
 * round's divider, exactly like the export system's own folder
 * assignment is never affected by display order.
 */
export function rebuildDeckFromOrder(data: EventMemoryData, orderedMomentIds: string[]): SlideshowDeck {
  const memoryById = new Map(data.memories.map(m => [m.momentId, m]))
  const orderedMemories = orderedMomentIds
    .map(id => memoryById.get(id))
    .filter((m): m is EventMemoryData['memories'][number] => m !== undefined)

  const slides: Slide[] = []
  const firstFavourite = orderedMemories.find(m => m.organiserFavourite)
  slides.push({
    kind: 'opening', eventName: data.event.name,
    dateRange: formatDateRange(data.event.startDate, data.event.endDate),
    heroImageUrl: firstFavourite?.imageUrl ?? null,
  })

  const eventLevel = orderedMemories.filter(m => m.roundId === null)
  if (eventLevel.length > 0) {
    slides.push({ kind: 'eventDivider' })
    for (const m of eventLevel) slides.push(toPhotoSlide(m, null))
  }

  const roundsById = new Map(data.rounds.map(r => [r.id, r]))
  const roundIdsInOrdinalOrder = [...data.rounds].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)).map(r => r.id)
  for (const roundId of roundIdsInOrdinalOrder) {
    const roundMemories = orderedMemories.filter(m => m.roundId === roundId)
    if (roundMemories.length === 0) continue
    const round = roundsById.get(roundId)
    if (!round) continue
    slides.push({ kind: 'roundDivider', roundId: round.id, roundName: round.name, courseName: round.courseName, playDate: round.playDate })
    for (const m of roundMemories) slides.push(toPhotoSlide(m, round.name))
  }

  slides.push({ kind: 'closing' })
  return { slides, memoryCount: orderedMemories.length }
}
