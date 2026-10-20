/**
 * 18 Oct field test -- decides whether a score request that hit a CLOSED
 * scorecard / round is just a harmless re-send of a score the server already
 * holds (see the long comment in src/app/api/scores/route.ts).
 *
 * Pure: `row` is whatever the server found for the request's client_id (or
 * null). It is an identical re-send only when EVERYTHING matches: card, hole,
 * role, value (including pick-up) and the user who entered it. Anything else
 * -- a different value, a different card, another user's row -- is not a
 * re-send and the closed-card refusal stands.
 */
export interface RecordedRow {
  scorecard_id: string
  hole_id: string
  capture_role: string
  gross_score: number | null
  is_no_return: boolean
  entered_by?: string | null
}

export interface ResendRequest {
  scorecard_id: string
  hole_id: string
  capture_role: 'self' | 'marker'
  gross_score: number | null
  is_no_return: boolean
}

export function isIdenticalRecordedResend(row: RecordedRow | null | undefined, req: ResendRequest, userId: string): boolean {
  if (!row) return false
  return (
    row.scorecard_id === req.scorecard_id &&
    row.hole_id === req.hole_id &&
    row.capture_role === req.capture_role &&
    row.is_no_return === req.is_no_return &&
    (row.gross_score ?? null) === (req.gross_score ?? null) &&
    row.entered_by === userId
  )
}
