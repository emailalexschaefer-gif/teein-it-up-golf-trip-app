/**
 * Official results of a round that was finished early.
 *   GET   (any trip member)  -> { finishedEarly, stale, changed[], added[], removed[] }  (is the frozen result potentially outdated?)
 *   POST  (organiser only)   { action: 'set_inclusion', countsTowardEvent, acknowledgeMixedNines? }  -> audited
 *                            { action: 'refresh' }                                                     -> audited "Refresh Official Results"
 * Results are frozen when the round is finished early; they are only ever changed by these explicit, audited actions.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdmin, getMemberRole, NO_STORE_HEADERS } from '@/lib/sharing/server'
import { earlyResultsStatus, setEarlyInclusion, refreshEarlyResults } from '@/lib/scoring/earlyFinish'

export const dynamic = 'force-dynamic'

interface RouteProps { params: Promise<{ tripId: string; roundId: string }> }
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE_HEADERS })

async function authorise(tripId: string) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { err: json({ error: 'Not authenticated.' }, 401) } as const
  const admin = getAdmin()
  const role = await getMemberRole(admin, tripId, user.id)
  if (!role) return { err: json({ error: 'Not a trip member.' }, 403) } as const
  return { admin, user, role } as const
}

export async function GET(_req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const a = await authorise(tripId); if ('err' in a) return a.err
  const r = await earlyResultsStatus(a.admin, tripId, roundId)
  // Players' names of changed scores are organiser information; other members only learn the flag.
  if (a.role !== 'organiser' && r.body && typeof r.body === 'object') { const b = r.body as Record<string, unknown>; delete b.changed; delete b.added; delete b.removed }
  return json(r.body, r.status)
}

export async function POST(req: NextRequest, { params }: RouteProps) {
  const { tripId, roundId } = await params
  const a = await authorise(tripId); if ('err' in a) return a.err
  if (a.role !== 'organiser') return json({ error: 'Only the organiser can change official results.' }, 403)
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* empty body */ }
  if (body.action === 'set_inclusion') {
    const r = await setEarlyInclusion(a.admin, { tripId, roundId, actorId: a.user.id, counts: body.countsTowardEvent, ackMixed: body.acknowledgeMixedNines })
    return json(r.body, r.status)
  }
  if (body.action === 'refresh') {
    const r = await refreshEarlyResults(a.admin, { tripId, roundId, actorId: a.user.id })
    return json(r.body, r.status)
  }
  return json({ error: 'Unknown action.' }, 400)
}
