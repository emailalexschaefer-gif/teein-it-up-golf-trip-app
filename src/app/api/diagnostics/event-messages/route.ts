/**
 * GET /api/diagnostics/event-messages
 *
 * TEMPORARY diagnostic endpoint — organiser-only, intended to be removed
 * once the production event_messages issue is root-caused. Returns
 * structured evidence about the live Supabase connection this deployed
 * instance is actually using: project hostname, auth state, table
 * reachability, and the exact Supabase/PostgREST error code if the table
 * isn't reachable. No keys, tokens, or secrets are ever returned.
 *
 * Requires ?tripId=... so the organiser-permission check has something to
 * check against (there's no trip-independent "is organiser" concept in
 * this schema — organiser status is always per-trip).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const tripId = req.nextUrl.searchParams.get('tripId')
  if (!tripId) {
    return NextResponse.json({ error: 'Pass ?tripId=<a trip you organise> to run this diagnostic.' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  // Project hostname only — never the anon key, service role key, or any
  // other secret. This is derived from the same env var the real app uses,
  // so it directly answers "which project is this deployment actually
  // talking to" without needing Vercel dashboard access.
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const projectHost = rawUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') || null

  if (authError || !user) {
    return NextResponse.json({
      projectHost, authenticated: false, profileId: null,
      tripMembershipFound: false, organiserPermissionFound: false,
      tableReachable: null, errorCode: null, errorMessage: null,
      testReadPermitted: null,
    })
  }

  // Organiser-only guard — this diagnostic itself must not leak table
  // reachability/error detail to a non-organiser.
  const { data: membership, error: membershipError } = await supabase
    .from('trip_members').select('role')
    .eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()

  const tripMembershipFound = !!membership
  const organiserPermissionFound = membership?.role === 'organiser'

  if (!organiserPermissionFound) {
    return NextResponse.json({ error: 'Organiser only.' }, { status: 403 })
  }

  // The actual test: can this exact request path (same client, same auth
  // context, same RLS as the real GET/POST routes) reach event_messages
  // at all? This distinguishes "table missing / not visible to PostgREST"
  // (PGRST205) from "table exists but RLS denies" (42501/permission
  // denied) from "wrong project entirely" (would show as a connection-
  // level failure rather than a Postgres error code).
  const testRead = await supabase.from('event_messages').select('id').eq('trip_id', tripId).limit(1)

  return NextResponse.json({
    projectHost,
    authenticated: true,
    profileId: user.id,
    tripMembershipFound,
    organiserPermissionFound,
    membershipQueryErrorCode: membershipError?.code ?? null,
    tableReachable: !testRead.error,
    errorCode: testRead.error?.code ?? null,
    errorMessage: testRead.error?.message ?? null,
    errorDetails: testRead.error?.details ?? null,
    errorHint: testRead.error?.hint ?? null,
    testReadPermitted: !testRead.error,
    rowsReturned: testRead.data?.length ?? 0,
  })
}
