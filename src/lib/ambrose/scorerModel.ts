// Package 4 / M2 -- team scorer screen view-model. PURE (no React, no network, no Dexie).
// Turns server scores + this device's queue rows + open flags into one cell per hole, so the screen only has to draw.
// A queued value is what the scorer typed; it is shown as "saving" until the server accepts it, and a conflict or organiser
// lock is surfaced -- never silently replaced.

import type { TeamQueueEntry } from './teamQueueRules'
import { runningGross } from './teamRound'

export interface HoleInfo { holeId: string; number: number; par: number }
export interface ServerHoleScore {
  holeId: string; grossScore: number | null; isNoReturn: boolean
  nrTreatment: 'no_score' | null; revision: number; locked: boolean; drivePlayerId: string | null
}

export type CellState =
  | 'empty' | 'scored' | 'saving' | 'offline_saved' | 'conflict' | 'locked'
  | 'no_return' | 'no_return_resolved' | 'rejected'

export interface HoleCell {
  holeId: string; number: number; par: number
  state: CellState
  gross: number | null
  revision: number            // the server revision this screen is showing (use as seenRevision)
  flagged: boolean
  note: string | null         // plain-language line for the scorer, or null
  needsAction: boolean
}

export const GROSS_MIN = 1
export const GROSS_MAX = 20

export function validateGross(n: unknown): { ok: true; value: number } | { ok: false; message: string } {
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, message: 'Enter a whole number.' }
  if (n < GROSS_MIN || n > GROSS_MAX) return { ok: false, message: `Enter a score from ${GROSS_MIN} to ${GROSS_MAX}. If the team picked up, use No Return.` }
  return { ok: true, value: n }
}

/** Latest queue row for a hole (the queue holds at most one live row plus history; the newest by enteredAt wins for display). */
function latestRow(rows: TeamQueueEntry[]): TeamQueueEntry | undefined {
  return [...rows].sort((a, b) => a.enteredAt.localeCompare(b.enteredAt)).filter(r => r.resolution !== 'superseded').pop()
}

export function buildHoleCells(holes: HoleInfo[], server: ServerHoleScore[], queue: TeamQueueEntry[], openFlagHoleIds: string[]): HoleCell[] {
  const sMap = new Map(server.map(s => [s.holeId, s]))
  const flagged = new Set(openFlagHoleIds)
  return [...holes].sort((a, b) => a.number - b.number).map(h => {
    const s = sMap.get(h.holeId)
    const q = latestRow(queue.filter(r => r.holeId === h.holeId))
    const base = { holeId: h.holeId, number: h.number, par: h.par, flagged: flagged.has(h.holeId), revision: s?.revision ?? 0 }
    const live = q && q.syncStatus !== 'synced' ? q : undefined
    if (live?.syncStatus === 'conflict') {
      const c = live.conflict
      return { ...base, state: c?.locked ? 'locked' as const : 'conflict' as const, gross: live.grossScore,
        note: c?.locked ? 'The organiser has set this hole. Accept their score, or ask them to change it.'
          : `Someone changed this hole${c?.serverGross != null ? ` to ${c.serverGross}` : c?.serverNoReturn ? ' to No Return' : ''}. Choose which score to keep.`, needsAction: true }
    }
    if (live?.syncStatus === 'rejected') return { ...base, state: 'rejected' as const, gross: live.grossScore, note: live.lastError ?? 'This score was not accepted.', needsAction: true }
    if (live) {
      const waiting = live.syncStatus === 'syncing'
      return { ...base, state: waiting ? 'saving' as const : 'offline_saved' as const, gross: live.isNoReturn ? null : live.grossScore,
        note: waiting ? 'Saving…' : 'Saved on this device. It will send when you are back online.', needsAction: false }
    }
    if (!s) return { ...base, state: 'empty' as const, gross: null, note: null, needsAction: false }
    if (s.isNoReturn) {
      return s.nrTreatment === 'no_score'
        ? { ...base, state: 'no_return_resolved' as const, gross: null, note: 'No Return — the organiser has recorded no score for this hole.', needsAction: false }
        : { ...base, state: 'no_return' as const, gross: null, note: 'No Return — waiting for the organiser to decide.', needsAction: false }
    }
    if (s.locked) return { ...base, state: 'locked' as const, gross: s.grossScore, note: 'Set by the organiser.', needsAction: false }
    return { ...base, state: 'scored' as const, gross: s.grossScore, note: null, needsAction: false }
  })
}

export function nextHoleToScore(cells: HoleCell[]): HoleCell | null {
  return cells.find(c => c.needsAction) ?? cells.find(c => c.state === 'empty') ?? null
}

export interface ProgressSummary { done: number; total: number; label: string; runningGross: number }
export function progressSummary(cells: HoleCell[]): ProgressSummary {
  const countable = cells.filter(c => ['scored', 'saving', 'offline_saved', 'locked'].includes(c.state) && c.gross !== null)
  const rg = runningGross(countable.map(c => ({ holeId: c.holeId, grossScore: c.gross, isNoReturn: false, nrTreatment: null })))
  return { done: countable.length, total: cells.length, label: `${countable.length} of ${cells.length} holes`, runningGross: rg.total }
}

export interface SyncSummary { pending: number; conflicts: number; rejected: number; banner: { tone: 'ok' | 'info' | 'warn'; text: string } }
export function syncSummary(queue: TeamQueueEntry[]): SyncSummary {
  const pending = queue.filter(r => ['pending', 'syncing', 'error'].includes(r.syncStatus)).length
  const conflicts = queue.filter(r => r.syncStatus === 'conflict').length
  const rejected = queue.filter(r => r.syncStatus === 'rejected').length
  const banner = conflicts > 0 ? { tone: 'warn' as const, text: `${conflicts} hole${conflicts === 1 ? '' : 's'} need${conflicts === 1 ? 's' : ''} your decision before more scores can be sent for ${conflicts === 1 ? 'it' : 'them'}.` }
    : rejected > 0 ? { tone: 'warn' as const, text: `${rejected} score${rejected === 1 ? ' was' : 's were'} not accepted. They are kept on this device.` }
    : pending > 0 ? { tone: 'info' as const, text: `${pending} score${pending === 1 ? '' : 's'} saved on this device, waiting to send.` }
    : { tone: 'ok' as const, text: 'All scores sent.' }
  return { pending, conflicts, rejected, banner }
}
