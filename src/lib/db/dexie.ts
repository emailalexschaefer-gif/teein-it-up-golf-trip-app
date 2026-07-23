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
    // v2: added captureRole ('self' | 'marker') for the marker scoring
    // model — a scorecard+hole can now have two independent queued entries,
    // so the dedupe key widens from (scorecardId, holeId) to
    // (scorecardId, holeId, captureRole). Existing queued rows (pre-marker
    // model) are backfilled to 'self', matching their original meaning.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(this as any).version(2).stores({
      scoreQueue: 'clientId, syncStatus, scorecardId, holeId, captureRole, enteredAt',
    }).upgrade((tx: { table: (name: string) => { toCollection: () => { modify: (fn: (e: OfflineScoreEntry) => void) => Promise<unknown> } } }) =>
      tx.table('scoreQueue').toCollection().modify((entry: OfflineScoreEntry) => {
        if (!entry.captureRole) entry.captureRole = 'self'
      })
    )
  }
}

export const db = new TeeInItUpDB()

/**
 * Queue a score for offline-first sync.
 *
 * If there is already an entry queued for the same (scorecardId, holeId,
 * captureRole) that hasn't finished syncing yet, this REPLACES it in place
 * (same clientId, status reset to 'pending', retryCount reset) instead of
 * adding a second queued row. This is what makes "editing an unsynced score
 * replaces the queued version" true — without this, two rapid edits to the
 * same hole+role before either syncs would both eventually hit the server
 * as separate requests.
 *
 * captureRole is part of the identity here deliberately: a self entry and a
 * marker entry for the same scorecard+hole are NOT the same logical record
 * and must never be deduped against each other (point 10 of the marker
 * scoring update).
 *
 * Returns the clientId that was actually used (new or reused), so callers
 * don't need to generate/track their own.
 */
export async function queueScoreEntry(
  entry: Omit<OfflineScoreEntry, 'clientId' | 'syncStatus' | 'retryCount'> & { clientId?: string }
): Promise<string> {
  const existing = await db.scoreQueue
    .where('scorecardId').equals(entry.scorecardId)
    .filter(e => e.holeId === entry.holeId && e.captureRole === entry.captureRole && e.syncStatus !== 'synced')
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
 * Mark a queued entry as synced — but only if its gross score and pick-up
 * state still match what was actually sent to the server. If the person
 * edited the same hole+role again while the request was in flight, this
 * won't match the (already-overwritten) queued record, and we deliberately
 * leave it 'pending' so the newer value goes out on the next sync pass
 * instead of being falsely marked complete.
 */
export async function markEntrySynced(
  clientId: string,
  sent?: { grossScore: number | null; isNoReturn: boolean }
) {
  const current = await db.scoreQueue.get(clientId)
  if (!current) return
  if (sent !== undefined && (current.grossScore !== sent.grossScore || current.isNoReturn !== sent.isNoReturn)) {
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
 * set of scorecard ids, keyed by `${scorecardId}:${holeId}:${captureRole}`.
 * Used on load to overlay local unsynced edits on top of server-hydrated
 * data, so a refresh never shows stale server data where a newer local edit
 * exists — and self/marker entries never collide under this key.
 */
export async function getQueuedEntriesForScorecards(
  scorecardIds: string[]
): Promise<Map<string, OfflineScoreEntry>> {
  const all = await db.scoreQueue
    .where('scorecardId').anyOf(scorecardIds)
    .filter(e => e.syncStatus !== 'synced')
    .toArray()
  const map = new Map<string, OfflineScoreEntry>()
  for (const e of all) map.set(`${e.scorecardId}:${e.holeId}:${e.captureRole}`, e)
  return map
}
