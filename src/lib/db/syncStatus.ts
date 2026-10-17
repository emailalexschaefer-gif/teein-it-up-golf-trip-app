/**
 * Offline-scoring Phase B — the single place that turns the real queue
 * state into what the player is told. Pure, so every state is testable.
 *
 * Hard rule: a label may only say a score is "saved on this device" when
 * the queue actually holds it (pendingCount > 0), and may only say
 * "synced" when nothing is owed to the server and nothing was refused.
 */

export type SyncPhase = 'idle' | 'syncing' | 'synced' | 'error'
export type FailureKind = 'network' | 'server' | 'invalid'
export type StatusTone = 'neutral' | 'progress' | 'ok' | 'warn' | 'bad'

export interface SyncStatusInput {
  online: boolean
  syncState: SyncPhase
  pendingCount: number
  rejectedCount: number
  lastFailure: FailureKind | null
}

export interface SyncStatusView {
  kind: 'idle' | 'offline' | 'saved_locally' | 'syncing' | 'synced' | 'unreachable' | 'failed' | 'rejected'
  label: string
  tone: StatusTone
}

function scores(n: number): string { return n === 1 ? '1 score' : `${n} scores` }

export function deriveSyncStatus(i: SyncStatusInput): SyncStatusView {
  if (i.rejectedCount > 0) {
    return { kind: 'rejected', tone: 'bad', label: `${scores(i.rejectedCount)} need${i.rejectedCount === 1 ? 's' : ''} review — not accepted by the server, kept on this device` }
  }

  if (i.pendingCount > 0) {
    if (i.syncState === 'syncing') {
      return { kind: 'syncing', tone: 'progress', label: 'Syncing scores…' }
    }
    if (!i.online) {
      return { kind: 'offline', tone: 'warn', label: `Offline — ${scores(i.pendingCount)} saved on this device, waiting to sync` }
    }
    if (i.syncState === 'error') {
      if (i.lastFailure === 'network') {
        return { kind: 'unreachable', tone: 'warn', label: `No connection to the server — ${scores(i.pendingCount)} saved on this device, retrying` }
      }
      return { kind: 'failed', tone: 'bad', label: `Sync failed — ${scores(i.pendingCount)} ${i.pendingCount === 1 ? 'is' : 'are'} still saved on this device` }
    }
    return { kind: 'saved_locally', tone: 'warn', label: `Saved on this device — waiting to sync (${i.pendingCount})` }
  }

  if (!i.online) return { kind: 'offline', tone: 'warn', label: 'Offline' }
  if (i.syncState === 'syncing') return { kind: 'syncing', tone: 'progress', label: 'Syncing scores…' }
  if (i.syncState === 'synced') return { kind: 'synced', tone: 'ok', label: 'All scores synced' }
  return { kind: 'idle', tone: 'neutral', label: '' }
}

/** The one rule for enabling "Confirm Final Scores" on the client. The
 * server's own submit gate is unchanged and remains the real authority. */
export function canConfirmRound(i: { allMatched: boolean; pendingCount: number; rejectedForThisRound: number }): boolean {
  return i.allMatched && i.pendingCount === 0 && i.rejectedForThisRound === 0
}
