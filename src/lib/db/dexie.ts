import Dexie, { type Table } from 'dexie'
import type { OfflineScoreEntry } from '@/types/app'

class TeeInItUpDB extends Dexie {
  scoreQueue!: Table<OfflineScoreEntry, string>

  constructor() {
    super('teeinitup_v1')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(this as any).version(1).stores({
      scoreQueue: 'clientId, syncStatus, scorecardId, holeId, enteredAt',
    })
  }
}

export const db = new TeeInItUpDB()

/**
 * Queue a score for offline-first sync.
 *
 * If there is already an entry queued for the same (scorecardId, holeId)
 * that hasn't finished syncing yet, this REPLACES it in place (same
 * clientId, status reset to 'pending', retryCount reset) instead of adding
 * a second queued row. This is what makes "editing an unsynced score
 * replaces the queued version" true — without this, two rapid edits to the
 * same hole before either syncs would both eventually hit the server as
 * separate requests.
 *
 * Returns the clientId that was actually used (new or reused), so callers
 * don't need to generate/track their own.
 */
export async function queueScoreEntry(
  entry: Omit<OfflineScoreEntry, 'clientId' | 'syncStatus' | 'retryCount'> & { clientId?: string }
): Promise<string> {
  const existing = await db.scoreQueue
    .where('scorecardId').equals(entry.scorecardId)
    .filter(e => e.holeId === entry.holeId && e.syncStatus !== 'synced')
    .first()

  const clientId = existing?.clientId ?? entry.clientId ?? crypto.randomUUID()

  await db.scoreQueue.put({
    ...entry,
    clientId,
    syncStatus: 'pending',
    retryCount: 0,
    lastError: undefined,
  })

  return clientId
}

export async function getPendingEntries(): Promise<OfflineScoreEntry[]> {
  return db.scoreQueue.where('syncStatus').anyOf(['pending', 'error']).sortBy('enteredAt')
}

/**
 * Mark a queued entry as synced — but only if its gross score still matches
 * what was actually sent to the server. If the person edited the same hole
 * again while the request was in flight, `sentGrossScore` will no longer
 * match the (already-overwritten) queued record, and we deliberately leave
 * it 'pending' so the newer value goes out on the next sync pass instead of
 * being falsely marked complete.
 */
export async function markEntrySynced(clientId: string, sentGrossScore?: number) {
  const current = await db.scoreQueue.get(clientId)
  if (!current) return
  if (sentGrossScore !== undefined && current.grossScore !== sentGrossScore) {
    return
  }
  await db.scoreQueue.update(clientId, { syncStatus: 'synced', lastError: undefined })
}

export async function markEntryError(clientId: string, error: string) {
  const entry = await db.scoreQueue.get(clientId)
  if (!entry) return
  await db.scoreQueue.update(clientId, {
    syncStatus: 'error',
    retryCount: entry.retryCount + 1,
    lastError: error,
  })
}

export async function markEntrySyncing(clientId: string) {
  await db.scoreQueue.update(clientId, { syncStatus: 'syncing' })
}

export async function getPendingCount(): Promise<number> {
  return db.scoreQueue.where('syncStatus').anyOf(['pending', 'error']).count()
}

/**
 * All still-relevant (not-yet-confirmed-synced) queued entries for a given
 * set of scorecard ids, keyed by `${scorecardId}:${holeId}`. Used on load to
 * overlay local unsynced edits on top of server-hydrated data, so a refresh
 * never shows stale server data where a newer local edit exists.
 */
export async function getQueuedEntriesForScorecards(
  scorecardIds: string[]
): Promise<Map<string, OfflineScoreEntry>> {
  const all = await db.scoreQueue
    .where('scorecardId').anyOf(scorecardIds)
    .filter(e => e.syncStatus !== 'synced')
    .toArray()
  const map = new Map<string, OfflineScoreEntry>()
  for (const e of all) map.set(`${e.scorecardId}:${e.holeId}`, e)
  return map
}
