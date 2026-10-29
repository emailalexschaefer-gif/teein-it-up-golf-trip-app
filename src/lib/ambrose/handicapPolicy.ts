// Package 4 / Sprint 2 -- a gross-only Ambrose round does not need playing handicaps, so Release and Begin Round must not demand them FOR THAT ROUND ONLY.
// Strictly format-scoped and fail-closed: this is true only when (a) the Ambrose feature flag is on, (b) the round has an Ambrose configuration whose
// handicap method is the explicit `gross_only`, and (c) that read succeeded. Any error, missing row, other method, or flag off -> handicaps stay REQUIRED
// exactly as before. A missing handicap is stored as 0 (scorecards.playing_handicap is NOT NULL DEFAULT 0, as Begin Round already does); it is not used.
import { ambroseEnabled } from './featureFlag'

interface Db { from(table: string): { select(cols: string): { eq(col: string, v: string): { maybeSingle(): PromiseLike<{ data: { handicap_method?: string } | null; error: unknown }> } } } }

export async function handicapsOptionalForRound(db: Db, roundId: string, enabled: boolean = ambroseEnabled()): Promise<boolean> {
  if (!enabled) return false
  try {
    const r = await db.from('round_competition_config').select('handicap_method').eq('round_id', roundId).maybeSingle()
    return !r.error && r.data?.handicap_method === 'gross_only'
  } catch { return false }
}
