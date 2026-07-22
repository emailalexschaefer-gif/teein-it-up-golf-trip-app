import {
  getPendingEntries, markEntrySynced, markEntryError,
  markEntrySyncing, getPendingCount,
} from './dexie'
import { useSyncStore } from '@/store/syncStore'

const MAX_RETRIES = 5
let syncInProgress = false

export async function syncScoreQueue(): Promise<void> {
  if (syncInProgress || typeof window === 'undefined') return

  const pending = await getPendingEntries()
  if (pending.length === 0) return

  syncInProgress = true
  const { setSyncing, setSyncComplete, setSyncError, setPendingCount } = useSyncStore.getState()
  setSyncing(true)

  let errors = 0

  for (const entry of pending) {
    if (entry.retryCount >= MAX_RETRIES) { errors++; continue }

    // Snapshot the gross score we're about to send. If the person edits this
    // same hole again before the request resolves, the queued record will
    // have moved on — markEntrySynced compares against this snapshot and
    // will not falsely mark the newer edit as synced.
    const sentGrossScore = entry.grossScore

    try {
      await markEntrySyncing(entry.clientId)

      const res = await fetch('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scorecard_id: entry.scorecardId,
          hole_id:      entry.holeId,
          gross_score:  entry.grossScore,
          is_no_return: entry.isNoReturn,
          client_id:    entry.clientId,
          entered_at:   entry.enteredAt,
        }),
      })

      if (res.ok || res.status === 409) {
        await markEntrySynced(entry.clientId, sentGrossScore)
      } else {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
    } catch (err) {
      await markEntryError(entry.clientId, err instanceof Error ? err.message : 'Unknown')
      errors++
    }
  }

  const remaining = await getPendingCount()
  setPendingCount(remaining)

  if (remaining === 0) {
    setSyncComplete()
  } else if (errors > 0) {
    setSyncError(`${errors} score(s) pending sync`)
  } else {
    setSyncing(false)
  }

  syncInProgress = false
}

export function initSyncListeners(): () => void {
  const handleOnline = () => syncScoreQueue()
  window.addEventListener('online', handleOnline)
  syncScoreQueue()
  return () => window.removeEventListener('online', handleOnline)
}
