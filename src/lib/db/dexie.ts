import Dexie, { type Table } from 'dexie'
import type { OfflineScoreEntry } from '@/types/app'
import { planQueueWrite, isInterruptedSyncing, latestPerKey, withTimeout, planConflictResolution, planTransportRequeue, type ConflictAction } from './queueRules'
import type { ServerScoreSnapshot } from './scoreAck'
import type { TeamQueueEntry } from '@/lib/ambrose/teamQueueRules'

class TeeInItUpDB extends Dexie {
  scoreQueue!: Table<OfflineScoreEntry, string>
  /** Package 4 / M2: team (Ambrose) scores. A separate store -- the individual scoreQueue above is not modified. */
  teamScoreQueue!: Table<TeamQueueEntry, string>

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
    // v3 (Package 4 / M2): ADDS the team score queue. Purely additive -- scoreQueue is neither redeclared nor migrated, so every row
    // queued on a player's device by V6/V7 is untouched.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(this as any).version(3).stores({
      teamScoreQueue: 'clientId, syncStatus, entryId, holeId, enteredAt',
    })
  }
}

export const db = new TeeInItUpDB()

/**
 * Queue a score for offline-first sync.
 *
 * Phase B (D1): what actually gets written is decided by the pure
 * planQueueWrite (queueRules.ts). In short:
 *  - the same value as the latest live entry is a no-op;
 *  - an edit to an entry that has provably never left the device replaces
 *    it in place;
 *  - an edit to an entry that may already have reached the server gets a
 *    NEW clientId (and the old one is retired) — a clientId the server may
 *    have recorded is never reused for a different value;
 *  - enteredAt is forced strictly increasing per (scorecard, hole, role),
 *    which is the revision number the server orders writes by.
 *
 * captureRole is part of the identity deliberately: a self entry and a
 * marker entry for the same scorecard+hole are NOT the same logical record
 * and are never merged.
 *
 * Read + decide + write happen in ONE Dexie transaction so two rapid saves
 * cannot interleave. Resolves only after IndexedDB has committed, and
 * rejects if the write fails — callers must treat a rejection as "NOT saved".
 *
 * Returns the clientId that now represents the score.
 */
export async function queueScoreEntry(
  entry: Omit<OfflineScoreEntry, 'clientId' | 'syncStatus' | 'retryCount'> & { clientId?: string }
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any
  return anyDb.transaction('rw', db.scoreQueue, async () => {
    const rows = await db.scoreQueue
      .where('scorecardId').equals(entry.scorecardId)
      .filter(e => e.holeId === entry.holeId && e.captureRole === entry.captureRole)
      .toArray()

    const plan = planQueueWrite(rows, {
      scorecardId: entry.scorecardId, holeId: entry.holeId, captureRole: entry.captureRole,
      grossScore: entry.grossScore, isNoReturn: entry.isNoReturn,
      enteredAt: entry.enteredAt, clientId: entry.clientId,
    }, Date.now(), () => crypto.randomUUID())

    if (plan.action === 'noop') return plan.clientId

    await db.scoreQueue.put(plan.row)
    for (const id of plan.deleteClientIds) {
      if (id !== plan.row.clientId) await db.scoreQueue.delete(id)
    }
    return plan.row.clientId
  }) as Promise<string>
}

/**
 * queueScoreEntry with a ceiling on how long we wait for IndexedDB.
 * Safari can leave an IndexedDB request pending indefinitely; waiting
 * forever would freeze hole navigation. A timeout is reported to the
 * caller as a FAILED local save — never as success — so the player is told
 * to use the paper card. (If the write does later complete, the score is
 * simply queued; nothing is claimed that is not true.)
 */
export function queueScoreEntryBounded(
  entry: Parameters<typeof queueScoreEntry>[0],
  timeoutMs = 5000,
): Promise<string> {
  return withTimeout(queueScoreEntry(entry), timeoutMs)
}

/** pending + error entries ready to upload. Interrupted ('syncing') ones
 * are reset to pending by recoverInterruptedEntries() first. */
export async function getPendingEntries(): Promise<OfflineScoreEntry[]> {
  return db.scoreQueue.where('syncStatus').anyOf(['pending', 'error']).sortBy('enteredAt')
}

/**
 * Reset entries abandoned in 'syncing' (page killed mid-request) back to
 * 'pending' so they are retried. Phase B (D2). The value, enteredAt and
 * clientId are untouched, so the retry is the same idempotent request and
 * cannot duplicate or overwrite a newer score (the server orders by
 * enteredAt). `force` is used once at startup, before this page has
 * started any upload of its own.
 */
export async function recoverInterruptedEntries(force = false): Promise<number> {
  const now = Date.now()
  const syncing = await db.scoreQueue.where('syncStatus').equals('syncing').toArray()
  const stuck = syncing.filter(e => isInterruptedSyncing(e, now, force))
  for (const e of stuck) {
    await db.scoreQueue.update(e.clientId, { syncStatus: 'pending', lastError: 'Interrupted — will retry', syncStartedAt: undefined })
  }
  return stuck.length
}

/**
 * Mark a queued entry as synced — but only if its gross score and pick-up
 * state still match what was actually sent to the server. If the row was
 * edited in place while the request was in flight, it won't match, and we
 * deliberately leave it pending so the newer value goes out on the next
 * pass instead of being falsely marked complete.
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
  await db.scoreQueue.update(clientId, { syncStatus: 'synced', lastError: undefined, syncStartedAt: undefined })
}

export async function markEntryError(clientId: string, error: string) {
  const entry = await db.scoreQueue.get(clientId)
  if (!entry) return
  await db.scoreQueue.update(clientId, {
    syncStatus: 'error',
    retryCount: entry.retryCount + 1,
    lastError: error,
    syncStartedAt: undefined,
  })
}

/** Phase B (D7): the server permanently refused this entry. It is KEPT. */
export async function markEntryRejected(clientId: string, reason: string) {
  const entry = await db.scoreQueue.get(clientId)
  if (!entry) return
  await db.scoreQueue.update(clientId, { syncStatus: 'rejected', lastError: reason, syncStartedAt: undefined })
}

/**
 * The server holds a DIFFERENT, newer value than this entry. Keep the entry
 * (status 'rejected' so it is never retried or counted as pending) and record
 * what the server holds so both values can be shown for review. Like
 * markEntrySynced, it only applies if the row still holds the value that was
 * actually sent.
 */
export async function markEntryConflict(
  clientId: string,
  sent: { grossScore: number | null; isNoReturn: boolean },
  server: ServerScoreSnapshot,
) {
  const current = await db.scoreQueue.get(clientId)
  if (!current) return
  if (current.grossScore !== sent.grossScore || current.isNoReturn !== sent.isNoReturn) return
  await db.scoreQueue.update(clientId, {
    syncStatus: 'rejected',
    lastError: 'A different score is already recorded on the server',
    syncStartedAt: undefined,
    conflict: { serverGross: server.grossScore, serverNoReturn: server.isNoReturn, serverEnteredAt: server.enteredAt },
  })
}

/**
 * Explicit user choice for a conflicting entry (see planConflictResolution).
 * Returns a human-readable refusal reason, or null when applied.
 */
export async function resolveConflictEntry(clientId: string, action: ConflictAction, isOrganiser: boolean): Promise<string | null> {
  const current = await db.scoreQueue.get(clientId)
  const plan = planConflictResolution(current, action, isOrganiser, Date.now())
  if (!plan.ok) return plan.reason
  await db.scoreQueue.update(clientId, plan.patch)
  return null
}

export async function markEntrySyncing(clientId: string) {
  const entry = await db.scoreQueue.get(clientId)
  if (!entry) return
  await db.scoreQueue.update(clientId, {
    syncStatus: 'syncing',
    syncStartedAt: new Date().toISOString(),
    sendAttempts: (entry.sendAttempts ?? 0) + 1,
  })
}

/** Everything still owed to the server: pending, error AND in-flight
 * ('syncing'). Rejected entries are deliberately NOT counted — see
 * getRejectedEntries. */
export async function getPendingCount(): Promise<number> {
  return db.scoreQueue.where('syncStatus').anyOf(['pending', 'error', 'syncing']).count()
}

export async function getRejectedEntries(): Promise<OfflineScoreEntry[]> {
  return db.scoreQueue.where('syncStatus').equals('rejected').sortBy('enteredAt')
}

export async function getRejectedCount(): Promise<number> {
  return db.scoreQueue.where('syncStatus').equals('rejected').count()
}

/** Explicit user action: try a refused entry again (e.g. the organiser has
 * since unlocked the card). Only ever applies to a 'rejected' row. */
export async function requeueRejectedEntry(clientId: string): Promise<boolean> {
  const e = await db.scoreQueue.get(clientId)
  if (!e || e.syncStatus !== 'rejected') return false
  // A conflict is never retried blindly - that could force an old local
  // value over a legitimate server correction. See resolveConflictEntry.
  if (e.conflict) return false
  await db.scoreQueue.update(clientId, { syncStatus: 'pending', retryCount: 0, lastError: undefined })
  return true
}

/**
 * One-time recovery for scores the OLD rule filed as refused after a routing/session 405 (see isTransportRejection).
 * They were never judged by the scoring server, so they go back in the queue. If the server really does refuse one, it comes
 * back as 'rejected' with its true reason. The server de-duplicates by client_id and orders by entered_at, so a retry is safe.
 */
export async function requeueTransportRejections(): Promise<number> {
  const ids = planTransportRequeue(await db.scoreQueue.toArray())
  for (const id of ids) await db.scoreQueue.update(id, { syncStatus: 'pending', retryCount: 0, lastError: undefined, syncStartedAt: undefined })
  return ids.length
}

/** Explicit, confirmed user action: permanently remove a refused entry
 * from this device. Refuses to touch anything that is not 'rejected', so
 * an unresolved or synced score can never be removed through this path. */
export async function discardRejectedEntry(clientId: string): Promise<boolean> {
  const e = await db.scoreQueue.get(clientId)
  if (!e || e.syncStatus !== 'rejected') return false
  await db.scoreQueue.delete(clientId)
  return true
}

/**
 * All still-relevant (not-yet-confirmed-synced) queued entries for a given
 * set of scorecard ids, keyed by `${scorecardId}:${holeId}:${captureRole}`.
 * Used on load to overlay local unsynced edits on top of server-hydrated
 * data, so a refresh never shows stale server data where a newer local edit
 * exists — and self/marker entries never collide under this key. When a key
 * has more than one row (e.g. a refused one and a newer edit), the newest
 * wins deterministically.
 */
export async function getQueuedEntriesForScorecards(
  scorecardIds: string[]
): Promise<Map<string, OfflineScoreEntry>> {
  // Newest row per key across ALL statuses first, THEN drop the ones that are
  // already confirmed — otherwise an older refused row could resurface behind
  // a newer synced one.
  const all = await db.scoreQueue.where('scorecardId').anyOf(scorecardIds).toArray()
  const latest = latestPerKey(all)
  // A conflicting entry is not shown as the score: the server's value is,
  // and the disagreement is reviewed in the sync banner.
  for (const [k, e] of latest) if (e.syncStatus === 'synced' || (e.syncStatus === 'rejected' && e.conflict)) latest.delete(k)
  return latest
}
