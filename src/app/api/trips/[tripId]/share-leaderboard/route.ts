/**
 * GET    -> sharing status. Any event member. The link is included for every
 *           member once an organiser has enabled it, so players can share it.
 * POST   -> enable the public link. Organiser only, and only with an explicit
 *           acknowledgement that full names and scores become public.
 * DELETE -> revoke the link. Organiser only. Permanent for that token.
 *
 * Existing events are never public until an organiser enables sharing.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdmin, getMemberRole, originFromRequest, NO_STORE_HEADERS } from '@/lib/sharing/server'
import { enableSharing, getActiveLink, leaderboardPath, revokeSharing } from '@/lib/leaderboardShare/service'

export const dynamic = 'force-dynamic'

interface RouteProps { params: Promise<{ tripId: string }> }

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE_HEADERS })

async function authorise(tripId: string) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { error: json({ error: 'Not authenticated.' }, 401) } as const
  const admin = getAdmin()
  const role = await getMemberRole(admin, tripId, user.id)
  if (!role) return { error: json({ error: 'Not a trip member.' }, 403) } as const
  return { user, admin, role } as const
}

export async function GET(req: NextRequest, { params }: RouteProps) {
  const { tripId } = await params
  const a = await authorise(tripId)
  if ('error' in a) return a.error
  const trip = await a.admin.from('trips').select('is_practice').eq('id', tripId).maybeSingle()
  if (!trip.data || trip.data.is_practice === true) return json({ available: false })
  const link = await getActiveLink(a.admin, tripId)
  return json({
    available: true, enabled: !!link, isOrganiser: a.role === 'organiser',
    ...(link ? { url: `${originFromRequest(req)}${leaderboardPath(link.token)}` } : {}),
  })
}

export async function POST(req: NextRequest, { params }: RouteProps) {
  const { tripId } = await params
  const a = await authorise(tripId)
  if ('error' in a) return a.error
  if (a.role !== 'organiser') return json({ error: 'Only the organiser can turn on public sharing.' }, 403)
  let body: { acknowledge?: unknown } = {}
  try { body = await req.json() } catch { /* handled below */ }
  if (body.acknowledge !== true) {
    return json({ error: 'Please confirm that full player names and scores will be visible to anyone with the link.' }, 400)
  }
  const trip = await a.admin.from('trips').select('is_practice').eq('id', tripId).maybeSingle()
  if (!trip.data) return json({ error: 'Event not found.' }, 404)
  if (trip.data.is_practice === true) return json({ error: 'Practice rounds cannot be shared.' }, 409)
  const link = await enableSharing(a.admin, { tripId, userId: a.user.id })
  if (!link) return json({ error: 'Could not turn on sharing. Please try again.' }, 500)
  return json({ available: true, enabled: true, isOrganiser: true, url: `${originFromRequest(req)}${leaderboardPath(link.token)}` })
}

export async function DELETE(_req: NextRequest, { params }: RouteProps) {
  const { tripId } = await params
  const a = await authorise(tripId)
  if ('error' in a) return a.error
  if (a.role !== 'organiser') return json({ error: 'Only the organiser can turn off public sharing.' }, 403)
  const ok = await revokeSharing(a.admin, { tripId, userId: a.user.id })
  if (!ok) return json({ error: 'Could not turn off sharing. Please try again.' }, 500)
  return json({ available: true, enabled: false, isOrganiser: true })
}
