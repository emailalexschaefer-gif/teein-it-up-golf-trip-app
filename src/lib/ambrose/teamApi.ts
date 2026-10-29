// Package 4 / M2 -- browser-side client for the team routes. PURE apart from the injected fetch. One place maps each action to its route and turns
// every kind of failure (signed out, redirect/405, HTML error page, network) into a message a person can act on, reusing the V7 transport rules.
import { isAuthFailure, describeUnexpectedTransport } from '@/lib/db/syncRunner'
import type { TeamAction } from './teamRpc'

export const ACTION_PATHS: Record<TeamAction, string> = {
  submit: '/api/team-scores', flag: '/api/team-scores/flag', resolve_flag: '/api/team-scores/flag/resolve', unlock: '/api/team-scores/unlock',
  resolve_no_return: '/api/team-scores/resolve-no-return', assign_scorer: '/api/team-entries/scorer', waive_drive: '/api/team-entries/waive-drive',
  create_team: '/api/team-teams', configure_round: '/api/team-entries/configure-round', save_entry: '/api/team-entries/roster', lock_handicap: '/api/team-entries/handicap',
  reopen_setup: '/api/team-entries/reopen-setup', relock_setup: '/api/team-entries/relock-setup',
}

export interface FetchLike { (url: string, init?: { method: string; headers?: Record<string, string>; body?: string }): Promise<{ ok: boolean; status: number; redirected?: boolean; url?: string; json(): Promise<unknown> }> }
export type ActionResult = { ok: true; body: Record<string, unknown> } | { ok: false; kind: 'auth' | 'transport' | 'rejected' | 'conflict' | 'network'; status: number; message: string; body?: Record<string, unknown> }

export async function postTeamAction(fetchFn: FetchLike, action: TeamAction, body: Record<string, unknown>): Promise<ActionResult> {
  let res: Awaited<ReturnType<FetchLike>>
  try { res = await fetchFn(ACTION_PATHS[action], { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }
  catch { return { ok: false, kind: 'network', status: 0, message: 'No connection. Nothing was changed.' } }
  if (isAuthFailure(res)) return { ok: false, kind: 'auth', status: res.status, message: 'Signed out of Teein’ It Up — sign in again.' }
  if (res.redirected || res.status === 405) return { ok: false, kind: 'transport', status: res.status, message: describeUnexpectedTransport(res) }
  let json: Record<string, unknown> | undefined
  try { const j = await res.json(); json = j && typeof j === 'object' ? j as Record<string, unknown> : undefined } catch { json = undefined }
  if (res.ok && json && typeof json.outcome === 'string') return { ok: true, body: json }
  const message = typeof json?.message === 'string' ? json.message : typeof json?.error === 'string' ? json.error : `The server answered HTTP ${res.status}.`
  return { ok: false, kind: res.status === 409 ? 'conflict' : 'rejected', status: res.status, message, body: json }
}

export type StateResult = { ok: true; state: unknown; viewerId: string } | { ok: false; kind: 'auth' | 'transport' | 'not_found' | 'network' | 'error'; message: string }
export async function getTeamState(fetchFn: FetchLike, roundId: string): Promise<StateResult> {
  let res: Awaited<ReturnType<FetchLike>>
  try { res = await fetchFn(`/api/team-state?round_id=${encodeURIComponent(roundId)}`, { method: 'GET' }) }
  catch { return { ok: false, kind: 'network', message: 'No connection. Showing the last known scorecard.' } }
  if (isAuthFailure(res)) return { ok: false, kind: 'auth', message: 'Signed out of Teein’ It Up — sign in again.' }
  if (res.redirected || res.status === 405) return { ok: false, kind: 'transport', message: describeUnexpectedTransport(res) }
  if (res.status === 404) return { ok: false, kind: 'not_found', message: 'This round was not found, or you are not a member of the event.' }
  let json: { state?: unknown; viewerId?: unknown; error?: unknown } | undefined
  try { json = await res.json() as typeof json } catch { json = undefined }
  if (res.ok && json?.state && typeof json.viewerId === 'string') return { ok: true, state: json.state, viewerId: json.viewerId }
  return { ok: false, kind: 'error', message: typeof json?.error === 'string' ? json.error : `The server answered HTTP ${res.status}.` }
}
