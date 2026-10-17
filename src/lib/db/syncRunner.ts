/**
 * Offline-scoring Phase B — the upload loop, with every side effect
 * injected so it can be exercised in tests with a fake queue, fake
 * network and fake clock. sync.ts wires the real Dexie queue, fetch and
 * Zustand store into this.
 *
 * Guarantees (each covered by tests):
 *  - A score is marked 'synced' ONLY after the server's answer has been
 *    validated as a real acknowledgement of that exact record
 *    (scoreAck.validateScoreAck). HTML, redirects, bad bodies -> not synced.
 *  - Every upload is bounded by a timeout (AbortController). On timeout or
 *    network failure the entry stays queued ('error', retried later) and the
 *    pass stops, so a dead connection costs one timeout, not one per entry.
 *  - A 'stale' answer carrying a DIFFERENT value than ours is a conflict:
 *    the local entry is kept for review ('rejected' + conflict), never
 *    marked synced and never forced over the server value. Organiser-locked
 *    holes are authoritative and simply retire the local entry.
 *  - A server refusal that cannot succeed on retry (4xx other than
 *    401/408/425/429) moves the entry to 'rejected': kept on the device,
 *    never retried automatically, never counted as pending, never deleted.
 *  - Interrupted ('syncing' forever) entries are recovered at the start of
 *    every pass.
 *  - Entries are uploaded oldest-first; the server orders by entered_at, so
 *    even an old request that arrives late cannot overwrite a newer one.
 */

import type { OfflineScoreEntry } from '@/types/app'
import { validateScoreAck, type AckResponseLike, type ServerScoreSnapshot } from './scoreAck'
import { classifyHttpFailure, SYNC_REQUEST_TIMEOUT_MS } from './queueRules'

export type FailureKind = 'network' | 'server' | 'invalid'

export interface SyncDeps {
  getPendingEntries(): Promise<OfflineScoreEntry[]>
  /** Reset abandoned 'syncing' entries to pending. Returns how many. */
  recoverInterrupted(): Promise<number>
  markSyncing(clientId: string): Promise<void>
  markSynced(clientId: string, sent: { grossScore: number | null; isNoReturn: boolean }): Promise<void>
  markError(clientId: string, message: string): Promise<void>
  markRejected(clientId: string, message: string): Promise<void>
  /** The server holds a DIFFERENT, newer value. Keep the local entry for review. */
  markConflict(clientId: string, sent: { grossScore: number | null; isNoReturn: boolean }, server: ServerScoreSnapshot): Promise<void>
  /** pending + error + syncing (everything still owed to the server). */
  getPendingCount(): Promise<number>
  getRejectedCount(): Promise<number>
  fetchFn(url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }): Promise<AckResponseLike>
  report: {
    syncing(v: boolean): void
    pendingCount(n: number): void
    rejectedCount(n: number): void
    complete(): void
    failed(message: string, kind: FailureKind): void
  }
  timeoutMs?: number
}

class UploadFailure extends Error {
  constructor(message: string, public kind: FailureKind) { super(message); this.name = 'UploadFailure' }
}

function describeNetworkError(err: unknown, timedOut: boolean): string {
  if (timedOut) return 'Timed out — no response from the server'
  return err instanceof Error && err.message ? err.message : 'Network error'
}

export function createSyncRunner(deps: SyncDeps): () => Promise<void> {
  const timeoutMs = deps.timeoutMs ?? SYNC_REQUEST_TIMEOUT_MS
  let inProgress = false
  let again = false

  async function uploadOne(entry: OfflineScoreEntry): Promise<'synced' | 'rejected' | 'conflict'> {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)

    let res: AckResponseLike
    try {
      res = await deps.fetchFn('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          scorecard_id: entry.scorecardId,
          hole_id:      entry.holeId,
          capture_role: entry.captureRole,
          gross_score:  entry.grossScore,
          is_no_return: entry.isNoReturn,
          client_id:    entry.clientId,
          entered_at:   entry.enteredAt,
        }),
      })
    } catch (err) {
      throw new UploadFailure(describeNetworkError(err, timedOut), 'network')
    }

    try {
      if (res.ok) {
        const ack = await validateScoreAck(res, {
          scorecardId: entry.scorecardId, holeId: entry.holeId, captureRole: entry.captureRole,
          grossScore: entry.grossScore, isNoReturn: entry.isNoReturn,
        })
        if (ack.kind === 'invalid') throw new UploadFailure(ack.reason, 'invalid')
        // The server kept another value. Organiser-locked, or the very same
        // value -> nothing to decide. A genuinely different newer value is
        // NEVER treated as synced: the local score is kept for review.
        if (ack.kind === 'superseded' && !ack.locked && !ack.sameValue) {
          await deps.markConflict(entry.clientId, { grossScore: entry.grossScore, isNoReturn: entry.isNoReturn }, ack.server)
          return 'conflict'
        }
        return 'synced'
      }

      // A body that stalls after the headers arrived is also bounded by the
      // same timer (the abort signal covers reading the body).
      const body = (await res.json().catch(() => ({}))) as { error?: unknown }
      const reason = typeof body.error === 'string' && body.error ? body.error : `HTTP ${res.status}`
      if (classifyHttpFailure(res.status) === 'permanent') {
        await deps.markRejected(entry.clientId, reason)
        return 'rejected'
      }
      throw new UploadFailure(reason, 'server')
    } catch (err) {
      if (err instanceof UploadFailure) throw err
      throw new UploadFailure(describeNetworkError(err, timedOut), 'network')
    } finally {
      clearTimeout(timer)
    }
  }

  return async function run(): Promise<void> {
    if (inProgress) { again = true; return }
    inProgress = true
    try {
      for (;;) {
        again = false
        await deps.recoverInterrupted()
        const pending = await deps.getPendingEntries()
        if (pending.length === 0) {
          // Nothing owed to the server — still publish the true counts.
          deps.report.pendingCount(await deps.getPendingCount())
          deps.report.rejectedCount(await deps.getRejectedCount())
          break
        }

        deps.report.syncing(true)
        let failures = 0
        let lastFailure: { message: string; kind: FailureKind } | null = null
        let connectivityLost = false

        for (const entry of pending) {
          const sent = { grossScore: entry.grossScore, isNoReturn: entry.isNoReturn }
          try {
            await deps.markSyncing(entry.clientId)
            const outcome = await uploadOne(entry)
            if (outcome === 'synced') await deps.markSynced(entry.clientId, sent)
          } catch (err) {
            const failure = err instanceof UploadFailure ? err : new UploadFailure(err instanceof Error ? err.message : 'Unknown', 'network')
            try { await deps.markError(entry.clientId, failure.message) } catch { /* the entry is still 'syncing' and will be recovered */ }
            failures++
            lastFailure = { message: failure.message, kind: failure.kind }
            if (failure.kind === 'network') { connectivityLost = true; break }
          }
        }

        const remaining = await deps.getPendingCount()
        const rejected = await deps.getRejectedCount()
        deps.report.pendingCount(remaining)
        deps.report.rejectedCount(rejected)

        if (remaining === 0) {
          deps.report.complete()
        } else if (failures > 0 && lastFailure) {
          deps.report.failed(`${remaining} score(s) pending sync — ${lastFailure.message}`, lastFailure.kind)
        } else {
          deps.report.syncing(false)
        }

        // Do not hammer a dead connection: the 8 s timer / `online` event
        // will start the next pass.
        if (connectivityLost) break
        if (!again) break
      }
    } finally {
      inProgress = false
    }
  }
}
