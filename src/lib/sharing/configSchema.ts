// Release 3S -- server-side validation of the PresentationConfig sent from the
// organiser's wizard. The config only chooses WHICH sections to include; it
// can never widen what media is eligible (eligibility.ts decides that).
import { z } from 'zod'
import type { PresentationConfig } from '@/lib/trips/slideshowDeck'

const uuid = z.string().uuid()

const roundSection = z.object({
  roundId: uuid, bestMoments: z.boolean(), sideGameWinners: z.boolean(), makersBreakers: z.boolean(), roundResults: z.boolean(),
})

export const publishConfigSchema = z.object({
  scope: z.object({ kind: z.literal('fullEvent') }),
  eventOpening: z.boolean(), eventAtAGlance: z.boolean(), groupPhoto: z.boolean(),
  rounds: z.array(roundSection).max(30),
  eventChampion: z.boolean(), finalLeaderboard: z.boolean(), bloopers: z.boolean(),
  aftershowLoop: z.boolean().optional(), eventFinale: z.boolean(),
  bestMomentsSource: z.enum(['favourites', 'all', 'selected']),
  selectedMomentIds: z.array(uuid).max(2000).optional(),
})

export const publishRequestSchema = z.object({
  action: z.enum(['preview', 'publish']),
  config: publishConfigSchema,
  durationSeconds: z.union([z.literal(5), z.literal(8), z.literal(10)]).default(8),
  nameMode: z.enum(['initials', 'full']).default('initials'),
  publicEnabled: z.boolean().default(false),
  attestCleared: z.boolean().default(false),
  excludedMomentIds: z.array(uuid).max(2000).default([]),
  attestFullNames: z.boolean().default(false),
})

export type PublishRequest = z.infer<typeof publishRequestSchema>

/** Rounds must belong to the event. Returns an error string or null. */
export function validateConfigAgainstEvent(config: PresentationConfig, realRoundIds: string[]): string | null {
  const real = new Set(realRoundIds)
  for (const r of config.rounds) if (!real.has(r.roundId)) return 'The presentation includes a round that is not part of this event.'
  return null
}
