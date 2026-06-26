// ─────────────────────────────────────────────────────────────────────────────
// TEEIN' IT UP — SCORE SYNC WORKER
// Drains the offline Dexie queue to the Supabase backend.
// Called when: app loads, connection restored, after each score entry.
// ─────────────────────────────────────────────────────────────────────────────

import {
  getPendingEntries,
  markEntrySynced,
  markEntryError,
  markEntrySyncing,
  getPendingCount,
} from './dexie'
import { useSyncStore } from '@/store/syncStore'

const MAX_RETRY_COUNT = 5
const RETRY_BACKOFF_MS = 2000 // Base backoff — multiplied by retry count

let syncInProgress = false

/**
 * Drain all pending score entries to the server.
 * Safe to call multiple times — guards against concurrent runs.
 */
export async function syncScoreQueue(): Promise<void> {
  if (syncInProgress) return
  if (typeof window === 'undefined') return // SSR guard

  const pendingEntries = await getPendingEntries()
  if (pendingEntries.length === 0) return

  syncInProgress = true
  const { setSyncing, setSyncComplete, setSyncError, setPendingCount } =
    useSyncStore.getState()

  setSyncing(true)

  let successCount = 0
  let errorCount = 0

  for (const entry of pendingEntries) {
    // Skip entries that have exceeded retry limit
    if (entry.retryCount >= MAX_RETRY_COUNT) {
      errorCount++
      continue
    }

    // Backoff for error entries
    if (entry.syncStatus === 'error' && entry.retryCount > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_BACKOFF_MS * entry.retryCount)
      )
    }

    try {
      await markEntrySyncing(entry.clientId)

      const response = await fetch('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scorecard_id: entry.scorecardId,
          hole_id: entry.holeId,
          gross_score: entry.grossScore,
          is_no_return: entry.isNoReturn,
          client_id: entry.clientId,
          entered_at: entry.enteredAt,
        }),
      })

      if (response.ok || response.status === 409) {
        // 409 = already exists (idempotent) — treat as success
        await markEntrySynced(entry.clientId)
        successCount++
      } else {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${response.status}`)
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error'
      await markEntryError(entry.clientId, message)
      errorCount++
    }
  }

  const remainingPending = await getPendingCount()
  setPendingCount(remainingPending)

  if (errorCount > 0 && successCount === 0) {
    setSyncError(`${errorCount} score(s) failed to sync. Will retry.`)
  } else if (remainingPending === 0) {
    setSyncComplete()
  } else {
    setSyncing(false)
  }

  syncInProgress = false
}

/**
 * Set up online/offline event listeners.
 * Call once on app mount.
 */
export function initSyncListeners(): () => void {
  const handleOnline = () => {
    console.log('[Sync] Connection restored — syncing queue')
    syncScoreQueue()
  }

  window.addEventListener('online', handleOnline)

  // Attempt sync on init in case there are queued entries from a previous session
  syncScoreQueue()

  return () => {
    window.removeEventListener('online', handleOnline)
  }
}
