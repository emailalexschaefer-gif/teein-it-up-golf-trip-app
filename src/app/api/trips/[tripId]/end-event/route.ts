/**
 * POST /api/trips/[tripId]/end-event  (organiser only)
 *   { preview: true }                                   -> impact preview, writes nothing
 *   { declareChampion: boolean, reason, note? }         -> ends the event early
 * Ending an event early, cancelling a round and declaring a champion are separate
 * decisions; the champion choice must be sent explicitly (defaults to NO).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdmin, getMemberRole, NO_STORE_HEADERS } from '@/lib/sharing/server'
import { endEvent } from '@/lib/scoring/eventEnd'

export const dynamic = 'force-dynamic'

interface RouteProps { params: Promise<{ tripId: string }> }
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE_HEADERS })

export async function POST(req: NextRequest, { params }: RouteProps) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return json({ error: 'Not authenticated.' }, 401)
  const admin = getAdmin()
  const role = await getMemberRole(admin, tripId, user.id)
  if (!role) return json({ error: 'Not a trip member.' }, 403)
  if (role !== 'organiser') return json({ error: 'Only the organiser can end the event.' }, 403)
  let body: { preview?: unknown; declareChampion?: unknown; reason?: unknown; note?: unknown } = {}
  try { body = await req.json() } catch { /* empty body */ }
  const result = await endEvent(admin, { tripId, userId: user.id, preview: body.preview === true, declareChampion: body.declareChampion, reason: body.reason, note: body.note })
  return json(result.body, result.status)
}
