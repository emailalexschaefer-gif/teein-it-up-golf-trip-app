/**
 * Offline-scoring Phase B — the pure rules behind the local score queue.
 *
 * dexie.ts is deliberately a thin I/O layer over these functions, so the
 * behaviour that matters (what happens when a score is edited, when an
 * upload is interrupted, how a server refusal is classified) can be
 * tested without IndexedDB. Nothing here imports Dexie, React or fetch.
 */

import type { OfflineScoreEntry } from '@/types/app'

/** Upper bound for ONE score upload. Past this the request is abandoned
 * (the entry stays queued and is retried) so one hung connection can
 * never block the queue indefinitely. */
export const SYNC_REQUEST_TIMEOUT_MS = 15_000

/** An entry left 'syncing' longer than this is treated as interrupted
 * (app killed / frozen mid-request). Must exceed SYNC_REQUEST_TIMEOUT_MS. */
export const SYNCING_STALE_MS = 30_000

export interface ScoreKey { scorecardId: string; holeId: string; captureRole: 'self' | 'marker' }

export function entryKey(e: ScoreKey): string {
  return `${e.scorecardId}:${e.holeId}:${e.captureRole}`
}

function ms(iso: string | undefined): number {
  if (!iso) return Number.NEGATIVE_INFINITY
  const v = Date.parse(iso)
  return Number.isNaN(v) ? Number.NEGATIVE_INFINITY : v
}

const UNRESOLVED = new Set(['pending', 'error', 'syncing'])

export interface QueueWriteInput extends ScoreKey {
  grossScore: number | null
  isNoReturn: boolean
  enteredAt?: string
  clientId?: string
}

export type QueueWritePlan =
  | { action: 'noop'; clientId: string }
  | { action: 'put'; row: OfflineScoreEntry; deleteClientIds: string[] }

function sameValue(e: OfflineScoreEntry, i: QueueWriteInput): boolean {
  return e.grossScore === i.grossScore && e.isNoReturn === i.isNoReturn
}

/**
 * Decide what to write when the player saves a score for one
 * (scorecard, hole, role).
 *
 * `rowsForKey` must be EVERY queue row for that key, in any status.
 *
 *  - Same value as the latest live row -> 'noop'. (Navigating away after the
 *    draft was already auto-saved must not queue a duplicate.)
 *  - New value, and the latest unresolved row has provably never been sent
 *    (sendAttempts === 0) -> replace it in place, same clientId.
 *  - New value, and the unresolved row may already have reached the server
 *    -> write a NEW row with a NEW clientId and retire the old one. This is
 *    the D1 fix: a client_id the server has already recorded is never
 *    reused for a different value.
 *  - enteredAt is forced strictly above every existing row's for this key,
 *    so it works as a revision number the server can order by.
 *  - 'rejected' rows are never modified or deleted here — a refused score
 *    is only ever resolved by an explicit user action.
 */
export function planQueueWrite(
  rowsForKey: OfflineScoreEntry[],
  input: QueueWriteInput,
  nowMs: number,
  newId: () => string,
): QueueWritePlan {
  const live = rowsForKey.filter(r => r.syncStatus !== 'rejected')
  const latestLive = live.slice().sort((a, b) => ms(b.enteredAt) - ms(a.enteredAt))[0]

  if (latestLive && sameValue(latestLive, input)) {
    return { action: 'noop', clientId: latestLive.clientId }
  }

  const base = ms(input.enteredAt) === Number.NEGATIVE_INFINITY ? nowMs : ms(input.enteredAt)
  const maxExisting = rowsForKey.reduce((m, r) => Math.max(m, ms(r.enteredAt)), Number.NEGATIVE_INFINITY)
  const enteredAtMs = Math.max(base, maxExisting + 1)
  const enteredAt = new Date(enteredAtMs).toISOString()

  const unresolved = rowsForKey.filter(r => UNRESOLVED.has(r.syncStatus))
  const neverSent = unresolved.length === 1 && unresolved[0].sendAttempts === 0 && unresolved[0].syncStatus === 'pending'

  if (neverSent) {
    const prev = unresolved[0]
    return {
      action: 'put',
      deleteClientIds: [],
      row: {
        ...prev,
        grossScore: input.grossScore,
        isNoReturn: input.isNoReturn,
        enteredAt,
        syncStatus: 'pending',
        retryCount: 0,
        lastError: undefined,
        sendAttempts: 0,
        syncStartedAt: undefined,
      },
    }
  }

  return {
    action: 'put',
    deleteClientIds: unresolved.map(r => r.clientId),
    row: {
      clientId: input.clientId ?? newId(),
      scorecardId: input.scorecardId,
      holeId: input.holeId,
      captureRole: input.captureRole,
      grossScore: input.grossScore,
      isNoReturn: input.isNoReturn,
      enteredAt,
      syncStatus: 'pending',
      retryCount: 0,
      lastError: undefined,
      sendAttempts: 0,
      syncStartedAt: undefined,
    },
  }
}

/** True when an entry is stuck 'syncing' because the page that was
 * uploading it is gone. `force` treats every 'syncing' row as abandoned
 * (used once at startup, before any upload of this page has begun). */
export function isInterruptedSyncing(e: OfflineScoreEntry, nowMs: number, force = false): boolean {
  if (e.syncStatus !== 'syncing') return false
  if (force) return true
  if (!e.syncStartedAt) return true
  return nowMs - ms(e.syncStartedAt) > SYNCING_STALE_MS
}

/** The newest row per (scorecard, hole, role). Used to overlay local
 * values on screen; with rejected + newer rows possible for one key, the
 * newest must win deterministically. */
export function latestPerKey(rows: OfflineScoreEntry[]): Map<string, OfflineScoreEntry> {
  const map = new Map<string, OfflineScoreEntry>()
  for (const r of rows) {
    const k = entryKey(r)
    const cur = map.get(k)
    if (!cur || ms(r.enteredAt) >= ms(cur.enteredAt)) map.set(k, r)
  }
  return map
}

export type FailureClass = 'transient' | 'permanent'

/** Is a non-2xx answer worth retrying by itself?
 *  Permanent: the server understood and refused (validation, permission,
 *  "round not active" ...). Retrying the identical request cannot help.
 *  Transient: auth/session, throttling, timeouts and server errors. */
export function classifyHttpFailure(status: number): FailureClass {
  if (status === 401 || status === 408 || status === 425 || status === 429) return 'transient'
  if (status >= 500) return 'transient'
  if (status >= 400) return 'permanent'
  // A 3xx/1xx that reached us is not a scoring answer — never "permanent".
  return 'transient'
}

export class TimeoutError extends Error {
  constructor(message = 'Timed out') { super(message); this.name = 'TimeoutError' }
}

/** Reject with TimeoutError if `p` has not settled within `timeoutMs`.
 * The underlying work is NOT cancelled — callers that need cancellation
 * (fetch) use an AbortController as well. */
export function withTimeout<T>(p: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError()), timeoutMs)
    p.then(
      v => { clearTimeout(t); resolve(v) },
      e => { clearTimeout(t); reject(e) },
    )
  })
}

// ── Conflict review (Phase B follow-up) ───────────────────────────────────

export type ConflictAction = 'accept_server' | 'replace_with_mine'

export type ConflictPlan =
  | { ok: true; patch: Partial<OfflineScoreEntry> }
  | { ok: false; reason: string }

/** True when a kept entry is a disagreement with the server (as opposed to a
 * plain server refusal). */
export function isConflictEntry(e: OfflineScoreEntry): boolean {
  return e.syncStatus === 'rejected' && !!e.conflict
}

/**
 * Decide what an EXPLICIT user choice does to a conflicting entry.
 *
 *  - accept_server: anyone may do this. The local value is dropped from the
 *    queue (kept only as an already-resolved row); the server value stands.
 *  - replace_with_mine: ORGANISER ONLY. The entry is re-queued with an
 *    entered_at just above the server's stored one so the server will take
 *    it. This is the only path that can overwrite a conflicting server value,
 *    it needs this explicit choice, and an organiser-locked hole is still
 *    refused by the server whatever happens here.
 *
 * A generic "retry" is deliberately not an option for a conflict.
 */
export function planConflictResolution(
  entry: OfflineScoreEntry | undefined,
  action: ConflictAction,
  isOrganiser: boolean,
  nowMs: number,
): ConflictPlan {
  if (!entry || !isConflictEntry(entry)) return { ok: false, reason: 'Not a score awaiting review' }

  if (action === 'accept_server') {
    return { ok: true, patch: { syncStatus: 'synced', conflict: undefined, lastError: undefined, syncStartedAt: undefined } }
  }

  if (!isOrganiser) return { ok: false, reason: 'Only the organiser can replace the recorded score' }
  const serverMs = ms(entry.conflict?.serverEnteredAt ?? undefined)
  const floor = Math.max(nowMs, ms(entry.enteredAt), serverMs === Number.NEGATIVE_INFINITY ? nowMs : serverMs + 1)
  return {
    ok: true,
    patch: {
      syncStatus: 'pending', conflict: undefined, lastError: undefined, retryCount: 0, syncStartedAt: undefined,
      enteredAt: new Date(floor).toISOString(),
    },
  }
}
