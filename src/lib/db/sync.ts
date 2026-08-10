import {
  getPendingEntries, markEntrySynced, markEntryError,
  markEntrySyncing, getPendingCount,
} from './dexie'
import { useSyncStore } from '@/store/syncStore'

const MAX_RETRIES = 5
let syncInProgress = false
// Root cause of "N scores still syncing" that never clears even though
// every hole shows matched/green and the total is correct: syncInProgress
// silently DROPPED any call that arrived while a sync was already
// in-flight, with nothing to pick the newly-queued entry back up
// afterward. Confirming two holes in quick succession (well within the
// ~480ms hole-advance delay above) queues hole B's entry while hole A's
// fetch is still in flight; hole B's own `void syncScoreQueue()` call
// then sees syncInProgress===true and returns immediately, doing
// nothing. If hole B happens to be the LAST hole, there's no next-hole
// confirm to trigger another sync pass afterward — the entry sits
// 'pending' in Dexie indefinitely (until reload, network toggle, or some
// other unrelated trigger), even though the scorecard UI already looks
// fully correct locally (queueScoreEntry writes to Dexie synchronously,
// before syncScoreQueue is ever called). This flag makes any call that
// arrives mid-sync schedule exactly one more pass immediately after the
// current one finishes, instead of being dropped — so an entry queued
// during an in-flight sync is always picked up without needing an
// external retrigger.
let syncAgainRequested = false

export async function syncScoreQueue(): Promise<void> {
  if (typeof window === 'undefined') return
  if (syncInProgress) { syncAgainRequested = true; return }

  syncInProgress = true
  const { setSyncing, setSyncComplete, setSyncError, setPendingCount } = useSyncStore.getState()

  try {
    // Looping (rather than a single pass) is what actually closes the
    // race described above: if a concurrent call arrives while we're
    // mid-pass, it sets syncAgainRequested instead of being dropped, and
    // the check at the bottom of this loop makes sure we immediately
    // requery and process whatever it queued — in the same invocation,
    // with no external retrigger required.
    for (;;) {
      syncAgainRequested = false
      const pending = await getPendingEntries()
      if (pending.length === 0) break

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

      // A concurrent call arrived while this pass was running — loop
      // immediately and process whatever it queued, rather than leaving
      // it stranded until some unrelated future trigger.
      if (!syncAgainRequested) break
    }
  } finally {
    syncInProgress = false
  }
}

export function initSyncListeners(): () => void {
  const handleOnline = () => syncScoreQueue()
  window.addEventListener('online', handleOnline)
  syncScoreQueue()
  return () => window.removeEventListener('online', handleOnline)
}
