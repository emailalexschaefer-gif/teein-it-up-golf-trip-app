/**
 * POST /api/trips/[tripId]/rounds/[roundId]/finish-early   (organiser only)
 *   { preview: true }                                                -> impact preview, writes nothing
 *   { reason, note?, countsTowardEvent, officialResult, acknowledgeMixedNines? } -> finishes the ACTIVE round early
 *
 * Distinct from Cancel Round (upcoming rounds only) and Close Round (normal completion). This never sets the
 * round to 'cancelled', never ends the event and never declares a champion. All writes happen in ONE database
 * transaction (finish_round_early, migration 100): round, decisions, official results and audit succeed or fail together.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdmin, getMemberRole, NO_STORE_HEADERS } from '@/lib/sharing/server'
import { previewFinishEarly, finishRoundEarly } from '@/lib/scoring/earlyFinish'

export const dynamic = 'force-dynamic'

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE_HEADERS })

export async function POST(req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return json({ error: 'Not authenticated.' }, 401)
  const admin = getAdmin()
  const role = await getMemberRole(admin, tripId, user.id)
  if (!role) return json({ error: 'Not a trip member.' }, 403)
  if (role !== 'organiser') return json({ error: 'Only the organiser can finish a round early.' }, 403)
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* empty body */ }
  const r = body.preview === true
    ? await previewFinishEarly(admin, tripId, roundId)
    : await finishRoundEarly(admin, { tripId, roundId, actorId: user.id, body: { reason: body.reason, note: body.note, countsTowardEvent: body.countsTowardEvent, officialResult: body.officialResult, acknowledgeMixedNines: body.acknowledgeMixedNines } })
  return json(r.body, r.status)
}
