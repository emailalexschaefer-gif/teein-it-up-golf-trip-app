/**
 * Release 3S -- PUBLIC media for a shared presentation (no account needed).
 * Serves a Moment only when ALL of: the token has the right shape, names an
 * ACTIVE publication, and the Moment is in that publication's
 * approved_public_moment_ids and belongs to the same event. Anything else is
 * an identical 404, so a probe learns nothing. The redirect target is a
 * short-lived signed URL; nothing permanent is ever exposed.
 */
import { isPlausibleShareToken } from '@/lib/sharing/token'
import { getAdmin, signMomentMedia, NO_STORE_HEADERS } from '@/lib/sharing/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteProps { params: Promise<{ token: string; momentId: string }> }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const notFound = () => new Response('Not found', { status: 404, headers: NO_STORE_HEADERS })

export async function GET(_req: Request, { params }: RouteProps) {
  const { token, momentId } = await params
  if (!isPlausibleShareToken(token) || !UUID.test(momentId)) return notFound()
  const admin = getAdmin()
  const { data: row } = await admin.from('shared_presentations').select('trip_id, approved_public_moment_ids').eq('token', token).eq('status', 'active').eq('public_enabled', true).maybeSingle()
  if (!row || !((row.approved_public_moment_ids ?? []) as string[]).includes(momentId)) return notFound()
  const url = await signMomentMedia(admin, row.trip_id as string, momentId)
  if (!url) return notFound()
  return new Response(null, { status: 302, headers: { ...NO_STORE_HEADERS, Location: url } })
}
