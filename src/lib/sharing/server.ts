// Release 3S -- server-only helpers shared by the publish, consent and media
// routes. Uses the service-role client: every caller performs its own
// membership/role check first, and nothing here is reachable from the browser.
import { createAdminClient } from '@/lib/supabase/admin'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getAdmin = (): any => createAdminClient()

export async function getMemberRole(admin: ReturnType<typeof getAdmin>, tripId: string, userId: string): Promise<string | null> {
  const { data } = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', userId).maybeSingle()
  return (data?.role as string | undefined) ?? null
}

export function originFromRequest(req: Request): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  if (host) return `${host.startsWith('localhost') ? 'http' : proto}://${host}`
  return new URL(req.url).origin
}

export const NO_STORE_HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } as const

export const PHOTO_URL_TTL_SECONDS = 600
export const VIDEO_URL_TTL_SECONDS = 1800

/** Short-lived signed URL for one Moment; null when missing or in another trip. */
export async function signMomentMedia(admin: ReturnType<typeof getAdmin>, tripId: string, momentId: string): Promise<string | null> {
  const { data: m } = await admin.from('moments').select('trip_id, image_path, moment_type').eq('id', momentId).maybeSingle()
  if (!m || m.trip_id !== tripId || !m.image_path) return null
  const ttl = m.moment_type === 'video' ? VIDEO_URL_TTL_SECONDS : PHOTO_URL_TTL_SECONDS
  const { data: signed } = await admin.storage.from('event-moments').createSignedUrl(m.image_path, ttl)
  return (signed?.signedUrl as string | undefined) ?? null
}
