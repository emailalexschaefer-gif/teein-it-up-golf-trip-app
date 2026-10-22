// Release 3S (pilot scope) -- which media may appear in a published
// presentation. Fail-closed. No per-player consent system in the pilot: the
// ORGANISER confirms clearance when publishing and removes any media whose
// permission is missing or disputed.
import type { EventMemoryData } from '@/lib/trips/eventMemoryData'

type Memory = EventMemoryData['memories'][number]

export type ExclusionReason = 'not_photo_or_video' | 'group_only' | 'organiser_excluded'

export const EXCLUSION_LABEL: Record<ExclusionReason, string> = {
  not_photo_or_video: 'Text-only Moments are never included',
  group_only: 'Shared with a playing group only',
  organiser_excluded: 'Removed from the public version by the organiser',
}

export interface ExcludedItem { momentId: string; reason: ExclusionReason }

export interface EligibilityFacts {
  /** The organiser confirmed the media is cleared for sharing outside the event. */
  publicEnabled: boolean
  /** Media the organiser removed from the public version. */
  excludedMomentIds: Set<string>
}

export interface EligibilityResult {
  eventMomentIds: string[]
  publicMomentIds: string[]
  publicExcluded: ExcludedItem[]
  eventExcluded: ExcludedItem[]
}

export function eventAudienceReason(m: Memory): ExclusionReason | null {
  if (m.mediaType !== 'photo' && m.mediaType !== 'video') return 'not_photo_or_video'
  if (m.audience !== 'everyone') return 'group_only'
  return null
}

export function computeEligibility(data: EventMemoryData, facts: EligibilityFacts): EligibilityResult {
  const eventMomentIds: string[] = []
  const publicMomentIds: string[] = []
  const publicExcluded: ExcludedItem[] = []
  const eventExcluded: ExcludedItem[] = []
  for (const m of data.memories) {
    const base = eventAudienceReason(m)
    if (base) { eventExcluded.push({ momentId: m.momentId, reason: base }); publicExcluded.push({ momentId: m.momentId, reason: base }); continue }
    eventMomentIds.push(m.momentId)
    if (!facts.publicEnabled) continue
    if (facts.excludedMomentIds.has(m.momentId)) publicExcluded.push({ momentId: m.momentId, reason: 'organiser_excluded' })
    else publicMomentIds.push(m.momentId)
  }
  return { eventMomentIds, publicMomentIds, publicExcluded, eventExcluded }
}
