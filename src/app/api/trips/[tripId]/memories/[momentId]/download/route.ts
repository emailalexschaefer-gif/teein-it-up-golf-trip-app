import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteProps { params: Promise<{ tripId: string; momentId: string }> }

/**
 * GET /api/trips/[tripId]/memories/[momentId]/download
 *
 * Event Memories V1 (10 Sep), Part 8 -- individual original download.
 * Returns a signed URL to the exact stored object -- no recompression,
 * since the stored file already is the "original" this app keeps
 * (photos are resized client-side to a 1600px max dimension before
 * upload; there is no separate higher-resolution copy anywhere to
 * fall back to).
 *
 * ACCESS MATCHES EXISTING MOMENT VISIBILITY, not a new, broader rule
 * (Part 16 -- "preserve existing privacy/permission rules"): a viewer
 * may download a Moment exactly when they could already see it --
 * 'everyone' audience, a 'group' Moment they share the group for, or
 * their own upload regardless of audience -- the identical shape as
 * moments' own RLS read policy, applied here explicitly since this
 * route uses the admin client (bypassing RLS) to generate the signed
 * URL and must therefore enforce the same rule itself.
 */
export async function GET(_req: Request, { params }: RouteProps) {
  const { tripId, momentId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const memberRes = await admin.from('trip_members').select('group_id').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberRes.data) return NextResponse.json({ error: 'Not a trip member.' }, { status: 403 })

  const momentRes = await admin.from('moments')
    .select('id, image_path, player_id, audience, group_id')
    .eq('id', momentId).eq('trip_id', tripId).maybeSingle()
  if (!momentRes.data) return NextResponse.json({ error: 'Moment not found for this event.' }, { status: 404 })

  const m = momentRes.data as { id: string; image_path: string; player_id: string; audience: string; group_id: string | null }
  const canAccess = m.audience === 'everyone' || m.player_id === user.id || (m.audience === 'group' && m.group_id !== null && m.group_id === memberRes.data.group_id)
  if (!canAccess) return NextResponse.json({ error: 'You do not have access to this Moment.' }, { status: 403 })

  const signedRes = await admin.storage.from('event-moments').createSignedUrl(m.image_path, 300)
  if (signedRes.error || !signedRes.data) {
    console.error('[memories/download]', signedRes.error?.message)
    return NextResponse.json({ error: 'Could not generate a download link. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ url: signedRes.data.signedUrl })
}
