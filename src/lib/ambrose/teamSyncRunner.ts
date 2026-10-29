// Package 4 / M2 -- upload loop for the team score queue. Every side effect is injected (same approach as db/syncRunner.ts) so it is
// tested with a fake queue, fake network and fake clock. It REUSES the V7 transport/auth rules (isAuthFailure, describeUnexpectedTransport,
// classifyHttpFailure) and the same one-failure-halts-the-pass behaviour; it does not touch the individual score runner.

import { isAuthFailure, describeUnexpectedTransport } from '@/lib/db/syncRunner'
import { classifyHttpFailure, SYNC_REQUEST_TIMEOUT_MS } from '@/lib/db/queueRules'
import { classifyOutcome } from './outcomes'
import { interpretAnswer, pendingOrder, type TeamQueueEntry, type ServerAnswer } from './teamQueueRules'

export interface TeamResponseLike { ok: boolean; status: number; redirected?: boolean; url?: string; json(): Promise<unknown> }

export interface TeamSyncDeps {
  allEntries(): Promise<TeamQueueEntry[]>
  recoverInterrupted(): Promise<number>
  patch(clientId: string, patch: Partial<TeamQueueEntry>): Promise<void>
  /** Atomically retire `oldId` and add a rebased copy (rule 4). */
  replaceWithRebased(oldId: string, newRow: TeamQueueEntry): Promise<void>
  newId(): string
  nowIso(): string
  fetchFn(url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }): Promise<TeamResponseLike>
  report: { pending(n: number): void; attention(n: number): void; failed(message: string): void; complete(): void; syncing(v: boolean): void }
  timeoutMs?: number
}

class Halt extends Error { constructor(message: string, public lapsed = false) { super(message) } }

export function createTeamSyncRunner(deps: TeamSyncDeps): () => Promise<void> {
  const timeoutMs = deps.timeoutMs ?? SYNC_REQUEST_TIMEOUT_MS
  let running = false

  async function send(e: TeamQueueEntry): Promise<void> {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    try {
      let res: TeamResponseLike
      try {
        res = await deps.fetchFn('/api/team-scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({
          client_id: e.clientId, entry_id: e.entryId, hole_id: e.holeId, gross_score: e.grossScore, is_no_return: e.isNoReturn,
          drive_player_id: e.drivePlayerId, base_revision: e.baseRevision, ...(e.reason ? { reason: e.reason } : {}),
        }) })
      } catch (err) {
        throw new Halt(timedOut ? 'Timed out — no response from the server' : (err instanceof Error && err.message ? err.message : 'Network error'))
      }
      if (isAuthFailure(res)) throw new Halt('Signed out of Teein’ It Up — sign in again. Your scores are safe on this device and will send automatically.', true)
      if (res.redirected || res.status === 405) throw new Halt(describeUnexpectedTransport(res))
      let body: unknown
      try { body = await res.json() } catch { body = undefined }
      const outcome = typeof (body as { outcome?: unknown })?.outcome === 'string' ? (body as ServerAnswer) : null
      if (!outcome) {
        // Not one of OUR answers (HTML error page, proxy, gateway): nothing is claimed about the score.
        if (res.ok) throw new Halt('The server gave an unreadable answer. The score is kept and will retry.')
        const reason = typeof (body as { error?: unknown })?.error === 'string' ? (body as { error: string }).error : `HTTP ${res.status}`
        if (classifyHttpFailure(res.status) === 'permanent') { await deps.patch(e.clientId, { syncStatus: 'rejected', lastError: reason, syncStartedAt: undefined }); return }
        throw new Halt(reason)
      }
      const applied = interpretAnswer(e, outcome, classifyOutcome)
      switch (applied.kind) {
        case 'synced': await deps.patch(e.clientId, { syncStatus: 'synced', lastError: undefined, syncStartedAt: undefined, baseRevision: e.baseRevision }); return
        case 'rebase': {
          await deps.replaceWithRebased(e.clientId, { ...e, clientId: deps.newId(), baseRevision: applied.newBaseRevision, enteredAt: deps.nowIso(), syncStatus: 'pending', retryCount: 0, lastError: undefined, syncStartedAt: undefined, priorSent: [] })
          return
        }
        case 'conflict': await deps.patch(e.clientId, { syncStatus: 'conflict', syncStartedAt: undefined, lastError: applied.locked ? 'The organiser set this hole' : 'The team score was changed since you last saw it',
          conflict: { serverRevision: applied.serverRevision, serverGross: applied.serverGross, serverNoReturn: applied.serverNoReturn, locked: applied.locked } }); return
        case 'rejected': await deps.patch(e.clientId, { syncStatus: 'rejected', lastError: applied.message, syncStartedAt: undefined }); return
        case 'invalid': throw new Halt(applied.message)
        case 'auth': throw new Halt('Signed out of Teein’ It Up — sign in again. Your scores are safe on this device and will send automatically.', true)
      }
    } finally { clearTimeout(timer) }
  }

  return async function run(): Promise<void> {
    if (running) return
    running = true
    try {
      await deps.recoverInterrupted()
      const todo = pendingOrder(await deps.allEntries())
      if (todo.length > 0) deps.report.syncing(true)
      let halted: string | null = null
      for (const e of todo) {
        try {
          await deps.patch(e.clientId, { syncStatus: 'syncing', syncStartedAt: deps.nowIso() })
          await send({ ...e, syncStatus: 'syncing', syncStartedAt: deps.nowIso() })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error'
          try { await deps.patch(e.clientId, { syncStatus: 'error', retryCount: e.retryCount + 1, lastError: msg, syncStartedAt: undefined }) } catch { /* recovered next pass */ }
          halted = msg
          break   // one failure halts the pass (dead connection / signed out / bad transport): no per-entry hammering
        }
      }
      const all = await deps.allEntries()
      const owed = all.filter(r => r.syncStatus === 'pending' || r.syncStatus === 'error' || r.syncStatus === 'syncing').length
      const attention = all.filter(r => r.syncStatus === 'conflict' || r.syncStatus === 'rejected').length
      deps.report.pending(owed); deps.report.attention(attention)
      if (halted) deps.report.failed(`${owed} team score(s) pending sync — ${halted}`)
      else if (owed === 0) deps.report.complete()
      else deps.report.syncing(false)
    } finally { running = false }
  }
}
