import {
  getPendingEntries, markEntrySynced, markEntryError, markEntryRejected, markEntryConflict,
  markEntrySyncing, getPendingCount, getRejectedCount, getRejectedEntries,
  recoverInterruptedEntries,
} from './dexie'
import { useSyncStore } from '@/store/syncStore'
import { createSyncRunner } from './syncRunner'

/**
 * Offline-scoring Phase B — the app's single upload loop.
 *
 * The loop itself lives in syncRunner.ts (pure, injected dependencies, unit
 * tested). This file only wires it to the real Dexie queue, fetch, and the
 * Zustand status store. History worth keeping from the previous version:
 *  - a call that arrives mid-sync schedules exactly one more pass instead
 *    of being dropped (so a score queued during an in-flight sync is never
 *    stranded) — preserved inside the runner;
 *  - entries are retried indefinitely (no MAX_RETRIES give-up), driven by
 *    the triggers below rather than a tight loop.
 * New in Phase B: per-request timeout, strict acknowledgement validation,
 * interrupted-entry recovery, and a 'rejected' state for permanent server
 * refusals.
 */

const runner = createSyncRunner({
  getPendingEntries,
  recoverInterrupted: () => recoverInterruptedEntries(false),
  markSyncing: markEntrySyncing,
  markSynced: markEntrySynced,
  markError: markEntryError,
  markRejected: markEntryRejected,
  markConflict: markEntryConflict,
  getPendingCount,
  getRejectedCount,
  fetchFn: (url, init) => fetch(url, init),
  report: {
    syncing: v => useSyncStore.getState().setSyncing(v),
    pendingCount: n => useSyncStore.getState().setPendingCount(n),
    rejectedCount: n => { void refreshRejected(n) },
    complete: () => useSyncStore.getState().setSyncComplete(),
    failed: (msg, kind) => useSyncStore.getState().setSyncError(msg, kind),
  },
})

async function refreshRejected(count: number): Promise<void> {
  const st = useSyncStore.getState()
  if (count === 0) { st.setRejected([]); return }
  try { st.setRejected(await getRejectedEntries()) } catch { st.setRejectedCount(count) }
}

// How many syncScoreQueue() calls are currently in flight in this tab (the
// runner itself serialises them; this only lets startup recovery know that an
// upload of THIS page may be mid-request).
let activeSyncCalls = 0

export async function syncScoreQueue(): Promise<void> {
  if (typeof window === 'undefined') return
  activeSyncCalls++
  try {
    await runner()
  } catch (err) {
    // Never let a storage failure become an unhandled rejection; the entries
    // themselves are untouched and the next trigger retries.
    console.error('[sync] pass failed', err)
    useSyncStore.getState().setSyncError('Could not read the saved-scores queue on this device', 'invalid')
  } finally {
    activeSyncCalls--
  }
}

/** Refresh the pending/rejected counts from IndexedDB without uploading. */
export async function refreshQueueCounts(): Promise<void> {
  try {
    const st = useSyncStore.getState()
    st.setPendingCount(await getPendingCount())
    await refreshRejected(await getRejectedCount())
  } catch (err) {
    console.error('[sync] could not read queue counts', err)
  }
}

export function initSyncListeners(): () => void {
  const store = useSyncStore.getState()
  store.setOnline(typeof navigator === 'undefined' ? true : navigator.onLine !== false)

  const handleOnline = () => { useSyncStore.getState().setOnline(true); void syncScoreQueue() }
  const handleOffline = () => { useSyncStore.getState().setOnline(false) }
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)

  // D2 — an upload interrupted by the page being killed leaves its entry in
  // 'syncing' forever. At startup nothing of THIS page is in flight yet, so
  // every 'syncing' entry is abandoned: reset it to pending, then sync.
  // (Skipped if another init in this same tab is already mid-upload.)
  void (async () => {
    try { if (activeSyncCalls === 0) await recoverInterruptedEntries(true) } catch (err) { console.error('[sync] recovery failed', err) }
    await refreshQueueCounts()
    void syncScoreQueue()
  })()

  // Periodic retry while anything is owed to the server — covers a slow or
  // flapping connection that never fires the browser's `online` event.
  // Stops calling the network the moment the queue is clear.
  const intervalId = window.setInterval(() => {
    if (useSyncStore.getState().pendingCount > 0) void syncScoreQueue()
  }, 8000)

  return () => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
    window.clearInterval(intervalId)
  }
}
