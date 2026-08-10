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
    // Previously: entries at MAX_RETRIES were skipped permanently on
    // every future call (still counted as pending, never attempted
    // again) — this is the actual root cause of a "N scores still
    // syncing" message that never clears even long after the original
    // failure (e.g. a transient network blip) has resolved. Now always
    // retries instead of giving up forever — this function is only
    // called on specific triggers (queueing a new entry, coming back
    // online, mount), not a tight loop, so there's no need for time-
    // based backoff to avoid hammering the server. Logs the entry's own
    // recorded lastError so the original failure reason is visible
    // rather than silently discarded.
    if (entry.retryCount >= MAX_RETRIES) {
      console.warn('[sync] retrying a previously-stuck entry beyond MAX_RETRIES', {
        clientId: entry.clientId, holeId: entry.holeId, captureRole: entry.captureRole,
        retryCount: entry.retryCount, lastError: entry.lastError,
      })
    }

    // Snapshot what we're about to send. If the person edits this same
    // hole+role again before the request resolves, the queued record will
    // have moved on — markEntrySynced compares against this snapshot and
    // will not falsely mark the newer edit as synced.
    const sent = { grossScore: entry.grossScore, isNoReturn: entry.isNoReturn }

    try {
      await markEntrySyncing(entry.clientId)

      const res = await fetch('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scorecard_id:  entry.scorecardId,
          hole_id:       entry.holeId,
          capture_role:  entry.captureRole,
          gross_score:   entry.grossScore,
          is_no_return:  entry.isNoReturn,
          client_id:     entry.clientId,
          entered_at:    entry.enteredAt,
        }),
      })

      if (res.ok) {
        await markEntrySynced(entry.clientId, sent)
      } else {
        const body = await res.json().catch(() => ({}))
        // Surfaced verbatim into the entry's lastError (below), and now
        // logged immediately too — this is what makes the ACTUAL server
        // rejection reason (e.g. "Scorecard not active" if a scorecard
        // was marked completed while a score for it was still queued
        // offline) visible, rather than only ever a generic stuck count.
        const reason = body.error || `HTTP ${res.status}`
        console.error('[sync] score rejected by server', {
          clientId: entry.clientId, holeId: entry.holeId, captureRole: entry.captureRole, reason,
        })
        throw new Error(reason)
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
