// POST-AUTH JOIN ROUTE
//
// After auth callback establishes the session and the browser follows the redirect here,
// this route:
//   1. Reads the authenticated user from the session cookie (now present on the request)
//   2. Joins them to the trip identified by inviteCode
//   3. Redirects to the trip page (or dashboard on failure)
//
// This runs server-side with the session cookies the callback just set,
// so auth.getUser() succeeds.

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const inviteCode = searchParams.get('inviteCode')?.toUpperCase()

  console.log('[api/auth/do-join] GET', { inviteCode })

  if (!inviteCode) {
    return NextResponse.redirect(`${origin}/dashboard`)
  }

  const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  // Read the authenticated user from the session cookies
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() { return request.cookies.getAll() },
      setAll() { /* read-only in this route */ },
    },
  })

  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    console.error('[api/auth/do-join] No authenticated user', authError?.message)
    // Not authenticated — send back to join page with the code
    return NextResponse.redirect(`${origin}/join/${inviteCode}`)
  }

  console.log('[api/auth/do-join] Authenticated user', { userId: user.id })

  // Use admin client to join the trip (bypasses RLS for the insert)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  // Look up trip
  const tripResult = await admin
    .from('trips')
    .select('id, name, status')
    .eq('invite_code', inviteCode)
    .single()

  const trip = tripResult?.data ?? null

  if (!trip || tripResult?.error) {
    console.error('[api/auth/do-join] Trip not found', inviteCode)
    return NextResponse.redirect(`${origin}/dashboard?joinError=trip_not_found`)
  }

  if (trip.status === 'archived') {
    console.log('[api/auth/do-join] Trip is archived')
    return NextResponse.redirect(`${origin}/dashboard?joinError=trip_archived`)
  }

  // Check existing membership
  const existingResult = await admin
    .from('trip_members')
    .select('id')
    .eq('trip_id', trip.id)
    .eq('profile_id', user.id)
    .maybeSingle()

  if (existingResult?.data) {
    console.log('[api/auth/do-join] Already a member — redirecting to trip')
    return NextResponse.redirect(`${origin}/trips/${trip.id}`)
  }

  // Insert membership
  const { error: insertError } = await admin
    .from('trip_members')
    .insert({ trip_id: trip.id, profile_id: user.id, role: 'player' })

  if (insertError) {
    console.error('[api/auth/do-join] Insert failed', insertError.message)
    return NextResponse.redirect(`${origin}/dashboard?joinError=insert_failed`)
  }

  console.log('[api/auth/do-join] Joined successfully', { tripId: trip.id, userId: user.id })
  return NextResponse.redirect(`${origin}/trips/${trip.id}`)
}
