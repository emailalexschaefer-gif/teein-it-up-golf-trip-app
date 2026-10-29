// Package 4 / V8 -- an Ambrose round is scored by TEAM entries only. The individual score routes (/api/scores, the organiser override and the shared-device
// route) must therefore refuse to write individual scores for it, even if someone opens or replays an individual-scoring URL directly.
// Strictly scoped: with the Ambrose flag OFF this does nothing and makes no query (production and ordinary Stableford rounds are untouched); with it ON it
// only blocks a round that has an Ambrose configuration. A failed or empty read means "not an Ambrose round" so ordinary scoring is never blocked by it.
import { ambroseEnabled } from './featureFlag'

interface Db { from(table: string): { select(cols: string): { eq(col: string, v: string): { maybeSingle(): PromiseLike<{ data: { format?: string } | null; error: unknown }> } } } }
export const AMBROSE_LEGACY_BLOCK = { status: 409, body: { error: 'This round is scored by team (Ambrose). Individual scores cannot be entered for it.', code: 'ambrose_round' } } as const

export async function ambroseLegacyScoreBlock(db: Db, roundId: string, enabled: boolean = ambroseEnabled()): Promise<typeof AMBROSE_LEGACY_BLOCK | null> {
  if (!enabled) return null
  try {
    const r = await db.from('round_competition_config').select('format').eq('round_id', roundId).maybeSingle()
    return !r.error && r.data?.format ? AMBROSE_LEGACY_BLOCK : null
  } catch { return null }
}
