// Package 4 / M2 -- thin, testable core of the team-score API routes. Each route file only wires `createClient()` into this.
//
// SECURITY CONTRACT: the database functions derive identity from auth.uid() and authority from the database. So this layer must
// be handed the SIGNED-IN USER'S OWN Supabase client (cookie session), never the service-role/admin client -- with the admin
// client auth.uid() is null and every function answers `not_authenticated`. Nothing about who the caller is, or whether they are
// an organiser, is ever sent to the database from here. This layer only validates shape and maps the outcome to HTTP.

import { z } from 'zod'
import { classifyOutcome } from './outcomes'
import type { TripRef } from './tripGate'

const uuid = z.string().uuid()
const reason = z.string().trim().min(1).max(300)

export const SUBMIT_SCHEMA = z.object({
  client_id: uuid, entry_id: uuid, hole_id: uuid,
  gross_score: z.number().int().min(1).max(20).nullable(),
  is_no_return: z.boolean(),
  drive_player_id: uuid.nullable().optional(),
  base_revision: z.number().int().min(0),
  reason: reason.optional(),
}).refine(v => (v.is_no_return && v.gross_score === null) || (!v.is_no_return && v.gross_score !== null),
  { message: 'gross_score must be null for a No Return, and a number 1-20 otherwise' })

interface ActionSpec { rpc: string; schema: z.ZodTypeAny; args: (b: never) => Record<string, unknown> }
const spec = <S extends z.ZodTypeAny>(rpc: string, schema: S, args: (b: z.infer<S>) => Record<string, unknown>): ActionSpec => ({ rpc, schema, args: args as (b: never) => Record<string, unknown> })

export const TEAM_ACTIONS = {
  submit: spec('submit_team_score', SUBMIT_SCHEMA, b => ({
    p_client_id: b.client_id, p_entry_id: b.entry_id, p_hole_id: b.hole_id, p_gross: b.gross_score, p_no_return: b.is_no_return,
    p_drive: b.drive_player_id ?? null, p_base_revision: b.base_revision, p_reason: b.reason ?? null })),
  flag: spec('raise_team_score_flag', z.object({ entry_id: uuid, hole_id: uuid, note: z.string().trim().max(300).optional() }),
    b => ({ p_entry_id: b.entry_id, p_hole_id: b.hole_id, p_note: b.note ?? null })),
  resolve_flag: spec('resolve_team_score_flag', z.object({ flag_id: uuid, status: z.enum(['resolved', 'dismissed']), note: z.string().trim().max(300).optional() }),
    b => ({ p_flag_id: b.flag_id, p_status: b.status, p_note: b.note ?? null })),
  assign_scorer: spec('assign_team_scorer', z.object({ entry_id: uuid, scorer_id: uuid }), b => ({ p_entry_id: b.entry_id, p_scorer: b.scorer_id })),
  unlock: spec('release_team_override_lock', z.object({ entry_id: uuid, hole_id: uuid, reason }), b => ({ p_entry_id: b.entry_id, p_hole_id: b.hole_id, p_reason: b.reason })),
  resolve_no_return: spec('resolve_team_no_return', z.object({ entry_id: uuid, hole_id: uuid, base_revision: z.number().int().min(1), reason }),
    b => ({ p_entry_id: b.entry_id, p_hole_id: b.hole_id, p_base_revision: b.base_revision, p_reason: b.reason })),
  waive_drive: spec('waive_team_drive_requirement', z.object({ entry_id: uuid, reason }), b => ({ p_entry_id: b.entry_id, p_reason: b.reason })),
  // Organiser setup (M2). The app's method id 'ga_weighted' is stored as 'weighted_scramble' in the database.
  create_team: spec('create_competition_team', z.object({ trip_id: uuid, name: z.string().trim().min(1).max(60), colour: z.string().max(20).optional() }),
    b => ({ p_trip_id: b.trip_id, p_name: b.name, p_colour: b.colour ?? null })),
  configure_round: spec('configure_round_competition', z.object({
    round_id: uuid, format: z.enum(['ambrose_2', 'ambrose_4']), method: z.enum(['gross_only', 'ga_weighted', 'club_divisor', 'organiser_entered']),
    params: z.record(z.unknown()).optional(), min_drives_per_player: z.number().int().min(0).max(18).nullable().optional() }),
    b => ({ p_round_id: b.round_id, p_format: b.format, p_method: b.method === 'ga_weighted' ? 'weighted_scramble' : b.method, p_params: b.params ?? {}, p_min_drives: b.min_drives_per_player ?? null })),
  save_entry: spec('save_round_team_entry', z.object({ round_id: uuid, team_id: uuid, member_ids: z.array(uuid).min(2).max(4), group_id: uuid.nullable().optional() }),
    b => ({ p_round_id: b.round_id, p_team_id: b.team_id, p_members: b.member_ids, p_group_id: b.group_id ?? null })),
  lock_handicap: spec('lock_team_handicap', z.object({ entry_id: uuid, team_handicap: z.number().min(-10).max(100), record: z.record(z.unknown()) }),
    b => ({ p_entry_id: b.entry_id, p_team_handicap: b.team_handicap, p_record: b.record })),
  reopen_setup: spec('reopen_team_setup', z.object({ round_id: uuid, reason }), b => ({ p_round_id: b.round_id, p_reason: b.reason })),
  relock_setup: spec('relock_team_setup', z.object({ round_id: uuid }), b => ({ p_round_id: b.round_id })),
} as const
export type TeamAction = keyof typeof TEAM_ACTIONS

export interface TeamRpcDeps {
  /** Result of supabase.auth.getUser() on the USER's client. */
  getUser(): Promise<{ id: string } | null>
  /** supabase.rpc(...) on the USER's client. */
  /** Server-side feature gate (routes pass ambroseEnabled). When it says no, the route answers 404 as if it did not exist. */
  enabled?: () => boolean
  /** Per-event gate (production only; resolves the event with the user's own client). When it says no, answer 404 as if the route did not exist. */
  tripAllowed?: (ref: TripRef) => Promise<boolean>
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string; code?: string } | null }>
}

export async function handleTeamAction(action: TeamAction, rawBody: unknown, deps: TeamRpcDeps): Promise<{ status: number; body: Record<string, unknown> }> {
  if (deps.enabled && !deps.enabled()) return { status: 404, body: { error: 'Not found' } }
  const user = await deps.getUser()
  if (!user) return { status: 401, body: { error: 'Not authenticated' } }
  const s = TEAM_ACTIONS[action]
  const parsed = s.schema.safeParse(rawBody)
  if (!parsed.success) return { status: 400, body: { error: 'Validation failed', issues: parsed.error.issues } }
  if (deps.tripAllowed) {
    const b = parsed.data as Record<string, unknown>
    const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : undefined)
    let allowed = false
    try { allowed = await deps.tripAllowed({ tripId: str('trip_id'), roundId: str('round_id'), entryId: str('entry_id'), flagId: str('flag_id') }) } catch { allowed = false }
    if (!allowed) return { status: 404, body: { error: 'Not found' } }
  }
  const { data, error } = await deps.rpc(s.rpc, s.args(parsed.data as never))
  if (error) {
    // 42501 = the database refused execution (privileges). Anything else is a server fault: transient for the queue (5xx), never a score claim.
    if (error.code === '42501') return { status: 403, body: { error: 'Not allowed' } }
    return { status: 503, body: { error: 'Team score service unavailable. Your score is kept and will retry.' } }
  }
  const obj = (data && typeof data === 'object' ? data : null) as Record<string, unknown> | null
  if (!obj || typeof obj.outcome !== 'string') return { status: 502, body: { error: 'Unexpected answer from the database' } }
  const info = classifyOutcome(obj.outcome)
  return { status: info.http, body: info.disposition === 'synced' ? obj : { ...obj, message: info.message } }
}
