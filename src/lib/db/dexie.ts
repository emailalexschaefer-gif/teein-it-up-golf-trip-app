// ─────────────────────────────────────────────────────────────────────────────
// TEEIN' IT UP — DEXIE OFFLINE QUEUE
// IndexedDB database for storing score entries when offline.
// Backend is always source of truth. This is a temporary sync queue only.
// ─────────────────────────────────────────────────────────────────────────────

import Dexie, { type Table } from 'dexie'
import type { OfflineScoreEntry } from '@/types/app'

class TeeInItUpDatabase extends Dexie {
  // Offline score queue — scores entered while offline or during connectivity issues
  scoreQueue!: Table<OfflineScoreEntry, string>  // keyed by clientId

  constructor() {
    super('teeinitup_v1')

    this.version(1).stores({
      // clientId is the primary key (UUID generated on device)
      // Indexed fields: syncStatus (for querying pending), scorecardId (for lookup)
      scoreQueue: 'clientId, syncStatus, scorecardId, enteredAt',
    })
  }
}

export const db = new TeeInItUpDatabase()

// ─── Queue operations ─────────────────────────────────────────────────────────

/** Add a score entry to the local queue immediately */
export async function queueScoreEntry(entry: OfflineScoreEntry): Promise<void> {
  await db.scoreQueue.put(entry)
}

/** Get all pending entries (not yet synced to server) */
export async function getPendingEntries(): Promise<OfflineScoreEntry[]> {
  return db.scoreQueue
    .where('syncStatus')
    .anyOf(['pending', 'error'])
    .sortBy('enteredAt')
}

/** Get all entries for a specific scorecard (for UI display) */
export async function getScorecardEntries(
  scorecardId: string
): Promise<OfflineScoreEntry[]> {
  return db.scoreQueue
    .where('scorecardId')
    .equals(scorecardId)
    .sortBy('enteredAt')
}

/** Mark an entry as successfully synced */
export async function markEntrySynced(clientId: string): Promise<void> {
  await db.scoreQueue.update(clientId, {
    syncStatus: 'synced',
    lastError: undefined,
  })
}

/** Mark an entry as failed (will retry) */
export async function markEntryError(
  clientId: string,
  error: string
): Promise<void> {
  const entry = await db.scoreQueue.get(clientId)
  if (!entry) return

  await db.scoreQueue.update(clientId, {
    syncStatus: 'error',
    retryCount: entry.retryCount + 1,
    lastError: error,
  })
}

/** Mark an entry as currently syncing */
export async function markEntrySyncing(clientId: string): Promise<void> {
  await db.scoreQueue.update(clientId, { syncStatus: 'syncing' })
}

/** Count of pending (unsynced) entries — for sync status badge */
export async function getPendingCount(): Promise<number> {
  return db.scoreQueue
    .where('syncStatus')
    .anyOf(['pending', 'error'])
    .count()
}

/** Remove synced entries older than 7 days (housekeeping) */
export async function purgeSyncedEntries(): Promise<void> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 7)
  const cutoffISO = cutoff.toISOString()

  await db.scoreQueue
    .where('syncStatus')
    .equals('synced')
    .and((entry) => entry.enteredAt < cutoffISO)
    .delete()
}
