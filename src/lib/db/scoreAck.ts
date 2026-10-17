/**
 * Offline-scoring Phase B (D6) — strict validation of the server's
 * answer to POST /api/scores before a queued score may be marked
 * "synced".
 *
 * The old client treated ANY `res.ok` as proof the score was stored.
 * That is wrong whenever something other than our API answers with a
 * 2xx: a club Wi-Fi captive portal, a proxy, or a middleware redirect
 * to the login page that fetch silently follows. This module only
 * accepts a real, JSON scoring acknowledgement that names the very
 * record we sent (and, for a normal write, carries the very value we
 * sent). Everything else is "invalid" and the entry stays queued.
 *
 * Pure — no browser or network access — so it can be tested directly.
 */

export interface AckResponseLike {
  ok: boolean
  status: number
  redirected?: boolean
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
}

export interface AckExpectation {
  scorecardId: string
  holeId: string
  captureRole: 'self' | 'marker'
  grossScore: number | null
  isNoReturn: boolean
}

/** What the server actually holds for this hole, taken from its answer. */
export interface ServerScoreSnapshot {
  grossScore: number | null
  isNoReturn: boolean
  enteredAt: string | null
}

export type AckResult =
  | { kind: 'confirmed' }
  /** The server kept a different (newer or organiser-set) value.
   *  `locked`: the organiser has overridden this hole - authoritative.
   *  `sameValue`: the stored value happens to equal ours (nothing to review).
   *  Otherwise it is a genuine disagreement that must be reviewed. */
  | { kind: 'superseded'; locked: boolean; sameValue: boolean; server: ServerScoreSnapshot }
  | { kind: 'invalid'; reason: string }

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export async function validateScoreAck(res: AckResponseLike, expected: AckExpectation): Promise<AckResult> {
  if (res.redirected) return { kind: 'invalid', reason: 'Unexpected redirect — not the scoring server' }

  const contentType = res.headers.get('content-type') ?? ''
  if (!/json/i.test(contentType)) return { kind: 'invalid', reason: 'Unexpected (non-JSON) response — not confirmed' }

  let body: unknown
  try { body = await res.json() } catch { return { kind: 'invalid', reason: 'Unreadable response — not confirmed' } }
  if (!isObject(body)) return { kind: 'invalid', reason: 'Unexpected response shape — not confirmed' }

  // Pre-Phase-B servers answered a repeated client_id with
  // { message: 'Already recorded', conflict: true } and no row. Accepted
  // only in exactly that form, so a new client keeps working during a
  // staggered deploy.
  if (body.conflict === true && body.message === 'Already recorded' && typeof body.id !== 'string') {
    return { kind: 'confirmed' }
  }

  if (typeof body.id !== 'string' || body.id.length === 0) {
    return { kind: 'invalid', reason: 'Response did not identify a stored score — not confirmed' }
  }

  const sameRecord =
    body.scorecard_id === expected.scorecardId &&
    body.hole_id === expected.holeId &&
    body.capture_role === expected.captureRole
  if (!sameRecord) return { kind: 'invalid', reason: 'Response was for a different record — not confirmed' }

  // A newer (or organiser-locked) value for this hole is already stored.
  if (body.stale === true || body.locked === true) {
    const grossOk = body.gross_score === null || typeof body.gross_score === 'number'
    if (!grossOk || typeof body.is_no_return !== 'boolean') {
      return { kind: 'invalid', reason: 'Response did not include the stored value — not confirmed' }
    }
    const server: ServerScoreSnapshot = {
      grossScore: body.gross_score as number | null,
      isNoReturn: body.is_no_return,
      enteredAt: typeof body.entered_at === 'string' ? body.entered_at : null,
    }
    return {
      kind: 'superseded',
      locked: body.locked === true,
      sameValue: server.grossScore === expected.grossScore && server.isNoReturn === expected.isNoReturn,
      server,
    }
  }

  if (body.gross_score !== expected.grossScore || body.is_no_return !== expected.isNoReturn) {
    return { kind: 'invalid', reason: 'Server stored a different value — not confirmed' }
  }
  return { kind: 'confirmed' }
}
