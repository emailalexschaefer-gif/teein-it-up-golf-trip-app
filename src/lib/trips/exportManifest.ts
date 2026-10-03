/**
 * Event Memories V1.1 Phase 2 (11 Sep) -- the deterministic export
 * organisation builder. Pure function, no Storage/network access --
 * built and tested in isolation before any ZIP generation, per the
 * explicit "build export organisation as pure logic first" instruction.
 *
 * Takes the (extended) Event Memory Manifest shape directly -- not a
 * second data model. See memory-manifest/route.ts for where these
 * fields come from and why each is authoritative.
 */

export type ExportMemorySourceType = 'GENERAL' | 'SIDE_GAME' | 'CHAT' | 'MAKER' | 'BREAKER' | 'HIGHLIGHT'

export interface ExportRound {
  id: string
  ordinal: number
  name: string
}

export interface ExportMemory {
  momentId: string
  roundId: string | null
  roundOrdinal: number | null
  holeNumber: number | null
  playerName: string | null
  caption: string | null
  imagePath: string
  createdAt: string
  organiserFavourite: boolean
  sourceType: ExportMemorySourceType
  sideCompName: string | null
  // V1.4 completion patch (14 Sep) -- migration 086/088.
  mediaType: 'photo' | 'text' | 'video'
  isBlooper: boolean
}

export type ExportScope =
  | { kind: 'all' }
  | { kind: 'favourites' }
  | { kind: 'round'; roundId: string }
  | { kind: 'selected'; momentIds: string[] }

export interface ExportEntry {
  momentId: string
  folderPath: string // forward-slash separated, no leading/trailing slash
  filename: string
  imagePath: string // the real Storage path -- for the ZIP step to actually fetch the bytes from
  isFavouriteDuplicate: boolean // true for the copy placed under "90 - FAVOURITE HIGHLIGHTS/"
  // V1.4 completion patch (14 Sep) -- true for the copy placed under
  // "91 - BLOOPERS/". Independent of isFavouriteDuplicate -- a single
  // Memory could in principle produce up to three entries (primary +
  // Favourite copy + Blooper copy) if it is both Favourite and
  // Blooper; each entry's own two flags describe which copy it is.
  isBlooperDuplicate: boolean
}

export interface ExportResult {
  eventFolderName: string
  entries: ExportEntry[]
  memoryCount: number // distinct Memories included (favourite/blooper duplicates don't count twice)
  favouriteCount: number
  blooperCount: number
}

const FAVOURITE_HIGHLIGHTS_FOLDER = '90 - FAVOURITE HIGHLIGHTS'
// V1.4 completion patch (14 Sep) -- mirrors Favourite Highlights'
// own pattern exactly: a selected Blooper remains in its normal
// round-level location AND gets a second, duplicated copy here --
// never a symlink/reference, a real second ZIP entry, matching the
// brief's own explicit "something obvious such as Bloopers/" request.
// Numbered 91 (immediately after 90) so both curated-highlight
// folders sort together at the end of the archive, after every real
// round folder.
const BLOOPERS_FOLDER = '91 - BLOOPERS'
const MAX_FILENAME_LENGTH = 180 // leaves headroom under common filesystem limits even with a folder path prefixed on extraction

/**
 * Sanitises a name fragment for safe use inside a filename or folder
 * name: strips anything that isn't alphanumeric/space/hyphen, then
 * turns spaces into hyphens. Never invents a replacement value --
 * an empty result after sanitising means the caller should omit the
 * fragment entirely, not substitute a placeholder.
 */
export function sanitiseNameFragment(raw: string): string {
  return raw
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // strip accents so e.g. "e" with an accent becomes a plain "e", not dropped entirely
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

function truncateFragment(fragment: string, maxLen: number): string {
  return fragment.length > maxLen ? fragment.slice(0, maxLen) : fragment
}

function fileExtension(imagePath: string): string {
  const match = imagePath.match(/\.([a-zA-Z0-9]+)$/)
  return match ? match[1].toLowerCase() : 'jpg' // 'jpg' only as a last-resort fallback for a path with no extension at all -- never guessed from content
}

/**
 * Folder path for a Memory's primary (non-Favourite-Highlights)
 * location. Event-level Memories (no round) go under "00 - EVENT/
 * GENERAL/" -- there is no Side Game concept without a round, per the
 * schema (side_comps.round_id, while nullable at the column level, is
 * never populated without a round in real usage -- a Side Game is
 * always configured against a specific round).
 */
export function folderPathFor(memory: ExportMemory): string {
  if (!memory.roundId || memory.roundOrdinal === null) {
    // V1.4 completion patch (14 Sep) -- a video Moment at event level
    // (no round) still never shares a folder with event-level photos
    // -- it is a different kind of media, and mixing them in one
    // listing would make the folder's own contents ambiguous at a
    // glance without opening each file.
    return memory.mediaType === 'video' ? '00 - EVENT/VIDEOS' : '00 - EVENT/GENERAL'
  }
  const roundFolder = `${String(memory.roundOrdinal).padStart(2, '0')} - ROUND ${memory.roundOrdinal}`
  // V1.4 completion patch (14 Sep) -- a video Moment is never routed
  // through the Side Game folder logic below, even if it happens to
  // carry sourceType === 'SIDE_GAME' context (a video captured
  // alongside a Side Game claim is a real, supported case) -- its own
  // ROUND/VIDEOS folder keeps every clip discoverable in one place
  // per round, rather than scattered across Side Game subfolders
  // alongside photos.
  if (memory.mediaType === 'video') {
    return `${roundFolder}/VIDEOS`
  }
  if (memory.sourceType === 'SIDE_GAME' && memory.sideCompName) {
    const gameFolder = sanitiseNameFragment(memory.sideCompName).toUpperCase() || 'SIDE-GAME'
    return `${roundFolder}/SIDE GAMES/${gameFolder}`
  }
  return `${roundFolder}/GENERAL MOMENTS`
}

/**
 * Deterministic base filename (without sequence number or extension)
 * for one Memory. Every fragment is included only if the underlying
 * data is actually known -- per the explicit "never add metadata that
 * isn't known" instruction, a missing hole/player/caption is omitted
 * entirely, never replaced with a placeholder like "Unknown".
 */
function baseFilenameFor(memory: ExportMemory): string {
  const parts: string[] = []
  parts.push(memory.roundOrdinal !== null ? `R${String(memory.roundOrdinal).padStart(2, '0')}` : 'EVENT')
  if (memory.holeNumber !== null) parts.push(`H${String(memory.holeNumber).padStart(2, '0')}`)
  if (memory.mediaType === 'video') {
    // V1.4 completion patch (14 Sep) -- CLIP, never GENERAL or a Side
    // Game name, even if sourceType happens to be SIDE_GAME -- the
    // filename itself should make "this is a video, not a photo"
    // obvious without opening it, matching the same principle as the
    // dedicated VIDEOS folder above.
    parts.push('CLIP')
  } else if (memory.sourceType === 'SIDE_GAME' && memory.sideCompName) {
    const gameName = sanitiseNameFragment(memory.sideCompName).toUpperCase()
    if (gameName) parts.push(gameName)
  } else {
    parts.push('GENERAL')
  }
  if (memory.playerName) {
    const playerFragment = sanitiseNameFragment(memory.playerName)
    if (playerFragment) parts.push(playerFragment)
  }
  if (memory.organiserFavourite) parts.push('FAVOURITE')
  // V1.4 completion patch (14 Sep) -- mirrors the FAVOURITE marker
  // immediately above. A Moment could in principle be both Favourite
  // and Blooper (independent selections, per the brief's own explicit
  // "do not require a video to also be a Favourite" -- which cuts
  // both ways: it also never prevents one) -- the filename simply
  // reflects whichever markers genuinely apply, in a fixed order.
  if (memory.isBlooper) parts.push('BLOOPER')
  return truncateFragment(parts.join('_'), MAX_FILENAME_LENGTH)
}

/**
 * Builds the full, collision-safe, deterministic export entry list for
 * a given scope. Chronological ordering (by createdAt) determines
 * both the overall processing order and, within any group of Memories
 * that would otherwise produce an identical base filename, the
 * sequence number each one receives -- always 001 for the first
 * chronologically, 002 for the next, etc. Running this function twice
 * on the same input always produces the same output.
 */
export function buildExportManifest(eventName: string, scope: ExportScope, allMemories: ExportMemory[]): ExportResult {
  const inScope = allMemories.filter(m => {
    // V1.4 completion patch (14 Sep) -- a text Moment has no
    // underlying file at all (image_path is null at the database
    // level for moment_type = 'text' -- confirmed directly against
    // migration 030's own CHECK constraint); it can never produce a
    // real ZIP entry, so it is excluded from every scope here, not
    // just silently dropped later when a download attempt would fail.
    if (m.mediaType === 'text') return false
    if (scope.kind === 'all') return true
    if (scope.kind === 'favourites') return m.organiserFavourite
    if (scope.kind === 'round') return m.roundId === scope.roundId
    return scope.momentIds.includes(m.momentId)
  })

  // Deterministic chronological order -- createdAt is the authoritative
  // capture timestamp (Phase 1 audit, item 3). A stable sort preserves
  // insertion order for any exact timestamp tie, which is itself
  // deterministic given the input array's own order (always
  // created_at ASC from the manifest route).
  const sorted = [...inScope].sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  const sequenceByBaseKey = new Map<string, number>()
  const entries: ExportEntry[] = []
  let favouriteCount = 0
  let blooperCount = 0

  for (const memory of sorted) {
    const folderPath = folderPathFor(memory)
    const baseFilename = baseFilenameFor(memory)
    const baseKey = `${folderPath}/${baseFilename}`
    const nextSeq = (sequenceByBaseKey.get(baseKey) ?? 0) + 1
    sequenceByBaseKey.set(baseKey, nextSeq)
    const ext = fileExtension(memory.imagePath)
    const filename = `${baseFilename}_${String(nextSeq).padStart(3, '0')}.${ext}`

    entries.push({ momentId: memory.momentId, folderPath, filename, imagePath: memory.imagePath, isFavouriteDuplicate: false, isBlooperDuplicate: false })

    if (memory.organiserFavourite) {
      favouriteCount += 1
      // Favourite Highlights duplication (Phase 2, item 4) -- the
      // exact same deterministic filename, placed under a second,
      // flat folder. A real duplicate ZIP entry, not a symlink or
      // reference -- per the explicit "must not rely on filesystem
      // shortcuts/symlinks that may fail on another device" instruction.
      entries.push({ momentId: memory.momentId, folderPath: FAVOURITE_HIGHLIGHTS_FOLDER, filename, imagePath: memory.imagePath, isFavouriteDuplicate: true })
    }
    if (memory.isBlooper) {
      blooperCount += 1
      // V1.4 completion patch (14 Sep) -- identical duplication
      // pattern to Favourite Highlights above, for the same reason:
      // a real second ZIP entry under a dedicated, obvious folder,
      // never a symlink. isFavouriteDuplicate stays false here (this
      // flag means specifically "this is the Favourite Highlights
      // copy") -- the Blooper copy is tracked separately via
      // isBlooperDuplicate, since a clip can independently be both,
      // neither, or either without the two concepts being conflated
      // into one boolean.
      entries.push({ momentId: memory.momentId, folderPath: BLOOPERS_FOLDER, filename, imagePath: memory.imagePath, isFavouriteDuplicate: false, isBlooperDuplicate: true })
    }
  }

  const eventFolderName = sanitiseNameFragment(eventName) || 'Event'

  return {
    eventFolderName,
    entries,
    memoryCount: sorted.length,
    favouriteCount,
    blooperCount,
  }
}
