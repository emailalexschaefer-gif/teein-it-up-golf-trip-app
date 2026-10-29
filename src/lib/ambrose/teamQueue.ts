// Package 4 / M2 -- Dexie-backed team score queue. Thin wrapper: every DECISION lives in teamQueueRules.ts / teamSyncRunner.ts (tested).
// Nothing calls this yet (the scorer screen is a later M2 stage), so shipping it changes no existing behaviour.
import { db, } from '@/lib/db/dexie'
import { withTimeout } from '@/lib/db/queueRules'
import { planTeamQueueWrite, planTeamConflictResolution, teamKey, type TeamQueueEntry, type TeamWriteInput, type TeamConflictAction } from './teamQueueRules'
import { createTeamSyncRunner } from './teamSyncRunner'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = db as any

/** Queue a team score. Read + decide + write in ONE transaction. Rejects if IndexedDB fails: treat a rejection as NOT saved. */
export async function queueTeamScore(input: TeamWriteInput): Promise<{ saved: true; clientId: string } | { saved: false; reason: string }> {
  return anyDb.transaction('rw', db.teamScoreQueue, async () => {
    const rows = await db.teamScoreQueue.where('entryId').equals(input.entryId).filter(r => r.holeId === input.holeId).toArray()
    const plan = planTeamQueueWrite(rows, input, new Date().toISOString(), () => crypto.randomUUID())
    if (plan.action === 'blocked') return { saved: false as const, reason: plan.reason }
    if (plan.action === 'noop') return { saved: true as const, clientId: plan.clientId }
    await db.teamScoreQueue.put(plan.row)
    for (const id of plan.deleteClientIds) if (id !== plan.row.clientId) await db.teamScoreQueue.delete(id)
    return { saved: true as const, clientId: plan.row.clientId }
  })
}

export function queueTeamScoreBounded(input: TeamWriteInput, timeoutMs = 5000) { return withTimeout(queueTeamScore(input), timeoutMs) }

export async function resolveTeamConflict(clientId: string, action: TeamConflictAction): Promise<string | null> {
  return anyDb.transaction('rw', db.teamScoreQueue, async () => {
    const row = await db.teamScoreQueue.get(clientId)
    const plan = planTeamConflictResolution(row, action, new Date().toISOString(), () => crypto.randomUUID())
    if (!plan.ok) return plan.reason
    await db.teamScoreQueue.update(clientId, plan.patchOld)
    if (plan.newRow) await db.teamScoreQueue.put(plan.newRow)
    return null
  })
}

export async function teamQueueSnapshot(entryId: string): Promise<TeamQueueEntry[]> { return db.teamScoreQueue.where('entryId').equals(entryId).toArray() }
export { teamKey }

const SYNCING_STALE_MS = 30_000
export function createDexieTeamSyncRunner(report: Parameters<typeof createTeamSyncRunner>[0]['report']) {
  return createTeamSyncRunner({
    allEntries: () => db.teamScoreQueue.toArray(),
    recoverInterrupted: async () => {
      const now = Date.now()
      const stuck = (await db.teamScoreQueue.where('syncStatus').equals('syncing').toArray()).filter(r => !r.syncStartedAt || now - Date.parse(r.syncStartedAt) > SYNCING_STALE_MS)
      for (const r of stuck) await db.teamScoreQueue.update(r.clientId, { syncStatus: 'pending', lastError: 'Interrupted — will retry', syncStartedAt: undefined })
      return stuck.length
    },
    patch: async (id, p) => { await db.teamScoreQueue.update(id, p) },
    replaceWithRebased: async (oldId, row) => { await anyDb.transaction('rw', db.teamScoreQueue, async () => { await db.teamScoreQueue.delete(oldId); await db.teamScoreQueue.put(row) }) },
    newId: () => crypto.randomUUID(), nowIso: () => new Date().toISOString(),
    fetchFn: (url, init) => fetch(url, init) as never,
    report,
  })
}
