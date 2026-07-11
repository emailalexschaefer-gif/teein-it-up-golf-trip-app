import Dexie, { type Table } from 'dexie'
import type { OfflineScoreEntry } from '@/types/app'

class TeeInItUpDB extends Dexie {
  scoreQueue!: Table<OfflineScoreEntry, string>

  constructor() {
    super('teeinitup_v1')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(this as any).version(1).stores({
      scoreQueue: 'clientId, syncStatus, scorecardId, enteredAt',
    })
  }
}

export const db = new TeeInItUpDB()

export async function queueScoreEntry(entry: OfflineScoreEntry) {
  await db.scoreQueue.put(entry)
}

export async function getPendingEntries(): Promise<OfflineScoreEntry[]> {
  return db.scoreQueue.where('syncStatus').anyOf(['pending', 'error']).sortBy('enteredAt')
}

export async function markEntrySynced(clientId: string) {
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
