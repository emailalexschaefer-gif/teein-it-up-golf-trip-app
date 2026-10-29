// Package 4 / M2 -- offline queue rules for team scores. PURE (no Dexie, no network). The individual scoreQueue and its rules are
// untouched; team scores have their own queue because the conflict model differs: a team score is ONE shared value guarded by a
// server revision, not "latest entered_at wins".
//
// Key rules (each tested):
//  1. Every queued write carries the revision the scorer last SAW (baseRevision). Chained offline edits to the same hole keep the
//     ORIGINAL base, so the server sees one logical change from the last known state.
//  2. A clientId the server may already have recorded is never reused for a different value.
//  3. A conflict is never auto-overwritten. The scorer sees the server value and chooses: accept it, or re-apply theirs on top of it.
//  4. Own-write rebase: if the server's newer value is exactly a value THIS device already sent for this hole (the response was lost),
//     the follow-up edit is rebased automatically -- that is not someone else's change.
//  5. An organiser lock ('locked') offers only "accept server". Unlocking is the organiser's audited action.
//  6. While a hole has an unresolved conflict, further edits to that hole are blocked until the scorer decides.

export type TeamSyncStatus = 'pending' | 'syncing' | 'synced' | 'error' | 'rejected' | 'conflict'

export interface TeamQueueEntry {
  clientId: string
  entryId: string
  holeId: string
  grossScore: number | null
  isNoReturn: boolean
  drivePlayerId: string | null
  baseRevision: number
  reason?: string
  enteredAt: string
  syncStatus: TeamSyncStatus
  retryCount: number
  lastError?: string
  syncStartedAt?: string
  /** Values this device has already sent (and may have landed) for this hole since the last known server state. */
  priorSent?: { grossScore: number | null; isNoReturn: boolean; drivePlayerId: string | null; revisionIfLanded: number }[]
  conflict?: { serverRevision: number; serverGross: number | null; serverNoReturn: boolean; locked: boolean }
  resolution?: 'accepted_server' | 'reapplied' | 'superseded'
}

export const teamKey = (e: { entryId: string; holeId: string }) => `${e.entryId}:${e.holeId}`
const LIVE: TeamSyncStatus[] = ['pending', 'error', 'syncing']
export const isLive = (e: TeamQueueEntry) => LIVE.includes(e.syncStatus)
const sameValue = (a: { grossScore: number | null; isNoReturn: boolean; drivePlayerId: string | null }, b: { grossScore: number | null; isNoReturn: boolean; drivePlayerId: string | null }) =>
  a.grossScore === b.grossScore && a.isNoReturn === b.isNoReturn && a.drivePlayerId === b.drivePlayerId

export interface TeamWriteInput {
  entryId: string; holeId: string
  grossScore: number | null; isNoReturn: boolean; drivePlayerId: string | null
  /** The server revision the scorer's screen is showing for this hole (0 = no score yet). Used only when nothing is already queued. */
  seenRevision: number
  reason?: string
}
export type TeamWritePlan =
  | { action: 'noop'; clientId: string }
  | { action: 'write'; row: TeamQueueEntry; deleteClientIds: string[] }
  | { action: 'blocked'; reason: string }

/** May the row have reached the server? (then its clientId is burned and its value may be the server's current value) */
export function mayHaveReachedServer(e: TeamQueueEntry): boolean {
  return e.syncStatus === 'syncing' || e.retryCount > 0 || e.syncStartedAt !== undefined
}

export function planTeamQueueWrite(rowsForKey: TeamQueueEntry[], input: TeamWriteInput, nowIso: string, newId: () => string): TeamWritePlan {
  if (rowsForKey.some(r => r.syncStatus === 'conflict')) {
    return { action: 'blocked', reason: 'This hole has a score conflict. Choose which score to keep before changing it.' }
  }
  const live = rowsForKey.filter(isLive).sort((a, b) => a.enteredAt.localeCompare(b.enteredAt))
  const latest = live[live.length - 1]
  const value = { grossScore: input.grossScore, isNoReturn: input.isNoReturn, drivePlayerId: input.drivePlayerId }
  if (latest && sameValue(latest, value)) return { action: 'noop', clientId: latest.clientId }

  if (!latest) {
    return { action: 'write', deleteClientIds: [], row: {
      clientId: newId(), entryId: input.entryId, holeId: input.holeId, ...value, baseRevision: input.seenRevision, reason: input.reason,
      enteredAt: nowIso, syncStatus: 'pending', retryCount: 0,
    } }
  }
  if (!mayHaveReachedServer(latest)) {
    // Provably never left the device: replace in place, keep the ORIGINAL base (rule 1).
    return { action: 'write', deleteClientIds: [], row: { ...latest, ...value, reason: input.reason ?? latest.reason, enteredAt: nowIso, syncStatus: 'pending', lastError: undefined } }
  }
  // It may have landed: new clientId (rule 2), same base (rule 1), remember what was sent so a lost-ack can be rebased (rule 4).
  const prior = [...(latest.priorSent ?? []), { grossScore: latest.grossScore, isNoReturn: latest.isNoReturn, drivePlayerId: latest.drivePlayerId, revisionIfLanded: latest.baseRevision + 1 + (latest.priorSent?.length ?? 0) }]
  return { action: 'write', deleteClientIds: [latest.clientId], row: {
    clientId: newId(), entryId: input.entryId, holeId: input.holeId, ...value, baseRevision: latest.baseRevision, reason: input.reason ?? latest.reason,
    enteredAt: nowIso, syncStatus: 'pending', retryCount: 0, priorSent: prior,
  } }
}

export interface ServerAnswer {
  outcome: string
  revision?: number
  gross_score?: number | null
  is_no_return?: boolean
}
export type AppliedAnswer =
  | { kind: 'synced'; revision: number }
  | { kind: 'rebase'; newBaseRevision: number }           // rule 4: re-send the same value on top of the server's (own) revision
  | { kind: 'conflict'; locked: boolean; serverRevision: number; serverGross: number | null; serverNoReturn: boolean }
  | { kind: 'rejected'; message: string }
  | { kind: 'auth' }
  | { kind: 'invalid'; message: string }

/** Decide what a server answer means for a queued row. Success is only believed when the answer echoes THIS write. */
export function interpretAnswer(row: TeamQueueEntry, ans: ServerAnswer, classify: (o: unknown) => { disposition: string; message: string }): AppliedAnswer {
  const info = classify(ans.outcome)
  if (info.disposition === 'synced') {
    if (typeof ans.revision !== 'number' || ans.revision < 1) return { kind: 'invalid', message: 'The server did not confirm the revision of this score.' }
    if (ans.outcome === 'inserted' || ans.outcome === 'updated') {
      if ((ans.gross_score ?? null) !== row.grossScore || ans.is_no_return !== row.isNoReturn) return { kind: 'invalid', message: 'The server confirmed a different score than the one sent.' }
    }
    return { kind: 'synced', revision: ans.revision }
  }
  if (info.disposition === 'conflict' || info.disposition === 'locked') {
    const serverRevision = typeof ans.revision === 'number' ? ans.revision : -1
    const serverGross = ans.gross_score ?? null
    const serverNoReturn = ans.is_no_return === true
    // Rule 4: the server's value is one THIS device sent earlier and the revision matches where that write would have landed.
    if (info.disposition === 'conflict') {
      const mine = (row.priorSent ?? []).find(p => p.revisionIfLanded === serverRevision && p.grossScore === serverGross && p.isNoReturn === serverNoReturn)
      if (mine) return { kind: 'rebase', newBaseRevision: serverRevision }
    }
    return { kind: 'conflict', locked: info.disposition === 'locked', serverRevision, serverGross, serverNoReturn }
  }
  if (info.disposition === 'auth') return { kind: 'auth' }
  return { kind: 'rejected', message: info.message }
}

export type TeamConflictAction = 'accept_server' | 'reapply_mine'
export type TeamConflictPlan =
  | { ok: true; patchOld: Partial<TeamQueueEntry>; newRow?: TeamQueueEntry }
  | { ok: false; reason: string }

export function planTeamConflictResolution(row: TeamQueueEntry | undefined, action: TeamConflictAction, nowIso: string, newId: () => string): TeamConflictPlan {
  if (!row || row.syncStatus !== 'conflict' || !row.conflict) return { ok: false, reason: 'There is no conflict to resolve for this score.' }
  if (action === 'accept_server') return { ok: true, patchOld: { syncStatus: 'synced', resolution: 'accepted_server', lastError: undefined } }
  if (row.conflict.locked) return { ok: false, reason: 'The organiser set this hole. Only the organiser can change it.' }
  // Deliberate re-apply: new clientId, based on the revision the scorer has now SEEN (the server's).
  return { ok: true, patchOld: { syncStatus: 'synced', resolution: 'superseded', lastError: undefined }, newRow: {
    clientId: newId(), entryId: row.entryId, holeId: row.holeId, grossScore: row.grossScore, isNoReturn: row.isNoReturn, drivePlayerId: row.drivePlayerId,
    baseRevision: row.conflict.serverRevision, reason: row.reason, enteredAt: nowIso, syncStatus: 'pending', retryCount: 0, resolution: 'reapplied',
  } }
}

/** Entries owed to the server, oldest first. Conflicts and rejections are NOT retried automatically and NEVER deleted. */
export function pendingOrder(rows: TeamQueueEntry[]): TeamQueueEntry[] {
  return rows.filter(r => r.syncStatus === 'pending' || r.syncStatus === 'error').sort((a, b) => a.enteredAt.localeCompare(b.enteredAt))
}
