// Release 3S -- builds the two stored decks (event-only and public) from the
// existing presentation engine. Media is referenced by synthetic marker
// ("tiu-media://{momentId}") so no signed URL or storage path is ever
// persisted; markers are turned into short-lived/authorised URLs at serve time.
import { buildPresentationDeck, type PresentationConfig, type SlideshowDeck } from '@/lib/trips/slideshowDeck'
import type { EventMemoryData } from '@/lib/trips/eventMemoryData'
import { abbreviateNamesDeep, type PublicNameMode } from './names'
import { computeEligibility, type EligibilityFacts, type ExcludedItem } from './eligibility'

export const MEDIA_MARKER_PREFIX = 'tiu-media://'
export const markerFor = (momentId: string) => `${MEDIA_MARKER_PREFIX}${momentId}`

export interface StoredDeck { slides: SlideshowDeck['slides']; aftershowStartIndex?: number; aftershowLoop?: boolean; memoryCount: number }

export interface SnapshotResult {
  eventDeck: StoredDeck
  publicDeck: StoredDeck
  approvedEventMomentIds: string[]
  approvedPublicMomentIds: string[]
  publicExcluded: ExcludedItem[]
  eventExcluded: ExcludedItem[]
}

/** Keeps only approved media, replaces URLs with markers, removes storage paths. */
function restrictData(data: EventMemoryData, approved: Set<string>): EventMemoryData {
  const memories = data.memories
    .filter(m => approved.has(m.momentId))
    .map(m => ({ ...m, imagePath: '', imageUrl: markerFor(m.momentId) }))
  return {
    ...data,
    event: {
      ...data.event,
      groupPhotoMomentId: data.event.groupPhotoMomentId && approved.has(data.event.groupPhotoMomentId) ? data.event.groupPhotoMomentId : null,
      championPhotoMomentId: data.event.championPhotoMomentId && approved.has(data.event.championPhotoMomentId) ? data.event.championPhotoMomentId : null,
    },
    memories,
  }
}

const URLISH_KEY = /(url|path|src)/i

/**
 * Fail-closed: any URL/path-like string that is not one of our markers is
 * dropped to null, so a future slide field can never leak a real URL.
 */
export function sanitizeDeckStrings<T>(value: T): T {
  const walk = (v: unknown, key: string): unknown => {
    if (typeof v === 'string') {
      if (URLISH_KEY.test(key) && !v.startsWith(MEDIA_MARKER_PREFIX)) return null
      return v
    }
    if (Array.isArray(v)) return v.map(x => walk(x, key))
    if (v !== null && typeof v === 'object') {
      const o: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) o[k] = walk(val, k)
      return o
    }
    return v
  }
  return walk(value, '') as T
}

function toStored(deck: SlideshowDeck): StoredDeck {
  return sanitizeDeckStrings({
    slides: deck.slides,
    aftershowStartIndex: deck.aftershowStartIndex,
    aftershowLoop: deck.aftershowLoop,
    memoryCount: deck.memoryCount,
  })
}

export function collectPlayerNames(data: EventMemoryData): string[] {
  const names = new Set<string>()
  const add = (n: string | null | undefined) => { if (n) names.add(n) }
  for (const m of data.memories) { add(m.playerName); add(m.capturedByName) }
  for (const r of data.rounds) {
    r.winners?.forEach(w => add(w.playerName)); r.standings?.forEach(s => add(s.playerName)); r.cumulativeStandings?.forEach(s => add(s.playerName))
  }
  data.sideGameWinners.forEach(w => add(w.winnerName))
  data.results.champion?.champions.forEach(c => add(c.playerName))
  data.results.champion?.standings.forEach(s => add(s.playerName))
  return [...names]
}

export function buildSnapshot(args: {
  data: EventMemoryData
  config: PresentationConfig
  facts: EligibilityFacts
  nameMode: PublicNameMode
}): SnapshotResult {
  const { data, config, facts, nameMode } = args
  const elig = computeEligibility(data, facts)
  const eventDeck = toStored(buildPresentationDeck(restrictData(data, new Set(elig.eventMomentIds)), config))
  // Public deck is only built when the organiser enabled public sharing; otherwise it stays empty.
  const rawPublic: StoredDeck = facts.publicEnabled
    ? toStored(buildPresentationDeck(restrictData(data, new Set(elig.publicMomentIds)), config))
    : { slides: [], memoryCount: 0 }
  const publicDeck = nameMode === 'full' ? rawPublic : abbreviateNamesDeep(rawPublic, collectPlayerNames(data))
  return {
    eventDeck, publicDeck,
    approvedEventMomentIds: elig.eventMomentIds,
    approvedPublicMomentIds: elig.publicMomentIds,
    publicExcluded: elig.publicExcluded,
    eventExcluded: elig.eventExcluded,
  }
}

/**
 * Serve-time: swap markers for real URLs. A marker whose moment is not in
 * `allowed`, or any non-marker URL-like string, becomes null (the player then
 * shows its existing trophy/artwork fallback).
 */
export function resolveMediaMarkers<T>(deck: T, allowed: Set<string>, urlFor: (momentId: string) => string): T {
  const walk = (v: unknown, key: string): unknown => {
    if (typeof v === 'string') {
      if (v.startsWith(MEDIA_MARKER_PREFIX)) {
        const id = v.slice(MEDIA_MARKER_PREFIX.length)
        return allowed.has(id) ? urlFor(id) : null
      }
      return URLISH_KEY.test(key) ? null : v
    }
    if (Array.isArray(v)) return v.map(x => walk(x, key))
    if (v !== null && typeof v === 'object') {
      const o: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) o[k] = walk(val, k)
      return o
    }
    return v
  }
  return walk(deck, '') as T
}
