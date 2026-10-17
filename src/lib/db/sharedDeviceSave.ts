/**
 * Offline-scoring Phase B (D4) — did the paper partner's score really reach
 * the server?
 *
 * In shared-device mode the second player's score is NOT part of the offline
 * queue (a deliberate scope limit of this package). It is a direct request,
 * so when there is no connection it genuinely is not saved, and the UI must
 * say so rather than claim a local save. Only a JSON `{ ok: true }` answer
 * from the endpoint counts as saved.
 */
export type SharedDeviceSaveResult = { saved: true } | { saved: false; reason: string }

export function interpretSharedDeviceSave(input: {
  threw: boolean
  status?: number
  redirected?: boolean
  body?: unknown
}): SharedDeviceSaveResult {
  if (input.threw) return { saved: false, reason: 'no connection' }
  const body = (typeof input.body === 'object' && input.body !== null ? input.body : null) as { ok?: unknown; error?: unknown } | null
  if (typeof input.status !== 'number' || input.status < 200 || input.status >= 300) {
    const why = body && typeof body.error === 'string' && body.error ? body.error : `server said ${input.status ?? 'nothing'}`
    return { saved: false, reason: why }
  }
  if (input.redirected || !body || body.ok !== true) return { saved: false, reason: 'no confirmation from the server' }
  return { saved: true }
}
