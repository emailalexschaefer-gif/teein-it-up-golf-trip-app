/**
 * Offline-scoring Phase B (D1) — the server-side write decision for
 * POST /api/scores, extracted as a pure function so its ordering
 * behaviour can be genuinely unit-tested (the route itself needs Next
 * and Supabase and cannot be run in the test sandbox).
 *
 * Problem it solves: the old route returned "Already recorded" for any
 * known client_id WITHOUT looking at the values, and otherwise
 * overwrote the (scorecard, hole, role) row with whatever arrived last.
 * That made two things possible:
 *   1. an edit that reused a client_id was silently discarded (the
 *      phone said 4, the server kept 5); and
 *   2. once a request can time out and be retried, an OLD request that
 *      finally reaches the server after a NEWER correction would
 *      overwrite it.
 *
 * The rule here is: the value with the latest `entered_at` wins,
 * regardless of the order requests arrive in. `entered_at` is made
 * strictly increasing per (scorecard, hole, role) by the client queue
 * (see queueRules.planQueueWrite), so it acts as a revision number
 * without needing a database migration.
 *
 *   - Identical resend (same client_id AND same values) -> 'duplicate'
 *     (acknowledged, nothing written).
 *   - Incoming is OLDER than what is recorded -> 'stale' (acknowledged
 *     as superseded, nothing written — the newer value is kept).
 *   - Otherwise -> 'update' (or 'insert' if no row exists yet).
 *
 * The route additionally applies `entered_at <= incoming` as a
 * condition on the UPDATE itself, so two concurrent requests cannot
 * race past this check.
 *
 * ORGANISER LOCK: a row the organiser has overridden (admin_overridden)
 * is authoritative and is checked FIRST, before any timestamp is
 * compared. A delayed offline submission can therefore never overwrite
 * it, whatever its entered_at or the phone's clock says. Later changes
 * go through the audited organiser override panel, which does not use
 * this route.
 */

export interface ExistingScoreRow {
  id: string
  client_id: string | null
  entered_at: string | null
  gross_score: number | null
  is_no_return: boolean
  /** true once the organiser has overridden this hole (migration 052) */
  admin_overridden?: boolean | null
}

export interface IncomingScore {
  client_id: string
  entered_at: string
  gross_score: number | null
  is_no_return: boolean
}

export type WriteDecision =
  | { action: 'insert' }
  | { action: 'update'; rowId: string }
  | { action: 'duplicate'; rowId: string }
  | { action: 'stale'; rowId: string }
  | { action: 'locked'; rowId: string }

function sameValues(a: ExistingScoreRow, b: IncomingScore): boolean {
  return a.gross_score === b.gross_score && a.is_no_return === b.is_no_return
}

function toMs(iso: string | null): number {
  if (!iso) return Number.NEGATIVE_INFINITY
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms
}

export function decideScoreWrite(existing: ExistingScoreRow | null, incoming: IncomingScore): WriteDecision {
  if (!existing) return { action: 'insert' }

  if (existing.admin_overridden === true) return { action: 'locked', rowId: existing.id }

  if (existing.client_id === incoming.client_id && sameValues(existing, incoming)) {
    return { action: 'duplicate', rowId: existing.id }
  }

  if (toMs(incoming.entered_at) < toMs(existing.entered_at)) {
    return { action: 'stale', rowId: existing.id }
  }

  return { action: 'update', rowId: existing.id }
}
