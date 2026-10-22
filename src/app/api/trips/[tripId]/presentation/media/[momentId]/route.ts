/**
 * Release 3S -- event-only media for the member presentation. Requires a
 * signed-in member of THIS event and a Moment in the active publication's
 * approved_event_moment_ids.
 */
import { createClient } from '@/lib/supabase/server'
import { getAdmin, getMemberRole, signMomentMedia, NO_STORE_HEADERS } from '@/lib/sharing/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteProps { params: Promise<{ tripId: string; momentId: string }> }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const notFound = () => new Response('Not found', { status: 404, headers: NO_STORE_HEADERS })

export async function GET(_req: Request, { params }: RouteProps) {
  const { tripId, momentId } = await params
  if (!UUID.test(tripId) || !UUID.test(momentId)) return notFound()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Not authenticated', { status: 401, headers: NO_STORE_HEADERS })
  const admin = getAdmin()
  if (!(await getMemberRole(admin, tripId, user.id))) return notFound()
  const { data: row } = await admin.from('shared_presentations').select('approved_event_moment_ids').eq('trip_id', tripId).eq('scope_key', 'event').eq('status', 'active').maybeSingle()
  if (!row || !((row.approved_event_moment_ids ?? []) as string[]).includes(momentId)) return notFound()
  const url = await signMomentMedia(admin, tripId, momentId)
  if (!url) return notFound()
  return new Response(null, { status: 302, headers: { ...NO_STORE_HEADERS, Location: url } })
}
