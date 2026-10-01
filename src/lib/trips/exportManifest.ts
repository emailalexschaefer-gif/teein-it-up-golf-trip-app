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
}

export interface ExportResult {
  eventFolderName: string
  entries: ExportEntry[]
  memoryCount: number // distinct Memories included (favourite duplicates don't count twice)
  favouriteCount: number
}

const FAVOURITE_HIGHLIGHTS_FOLDER = '90 - FAVOURITE HIGHLIGHTS'
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
    return '00 - EVENT/GENERAL'
  }
  const roundFolder = `${String(memory.roundOrdinal).padStart(2, '0')} - ROUND ${memory.roundOrdinal}`
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
  if (memory.sourceType === 'SIDE_GAME' && memory.sideCompName) {
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

  for (const memory of sorted) {
    const folderPath = folderPathFor(memory)
    const baseFilename = baseFilenameFor(memory)
    const baseKey = `${folderPath}/${baseFilename}`
    const nextSeq = (sequenceByBaseKey.get(baseKey) ?? 0) + 1
    sequenceByBaseKey.set(baseKey, nextSeq)
    const ext = fileExtension(memory.imagePath)
    const filename = `${baseFilename}_${String(nextSeq).padStart(3, '0')}.${ext}`

    entries.push({ momentId: memory.momentId, folderPath, filename, imagePath: memory.imagePath, isFavouriteDuplicate: false })

    if (memory.organiserFavourite) {
      favouriteCount += 1
      // Favourite Highlights duplication (Phase 2, item 4) -- the
      // exact same deterministic filename, placed under a second,
      // flat folder. A real duplicate ZIP entry, not a symlink or
      // reference -- per the explicit "must not rely on filesystem
      // shortcuts/symlinks that may fail on another device" instruction.
      entries.push({ momentId: memory.momentId, folderPath: FAVOURITE_HIGHLIGHTS_FOLDER, filename, imagePath: memory.imagePath, isFavouriteDuplicate: true })
    }
  }

  const eventFolderName = sanitiseNameFragment(eventName) || 'Event'

  return {
    eventFolderName,
    entries,
    memoryCount: sorted.length,
    favouriteCount,
  }
}
