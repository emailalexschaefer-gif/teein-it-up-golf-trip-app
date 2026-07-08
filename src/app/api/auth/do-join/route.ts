import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const inviteCode = searchParams.get('inviteCode')?.toUpperCase()

  console.log('[do-join] ── START ──', {
    inviteCode,
    cookies: request.cookies.getAll().map(c => c.name),
  })

  if (!inviteCode) {
    console.log('[do-join] No inviteCode — going to dashboard')
    return NextResponse.redirect(`${origin}/dashboard`)
  }

  const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() { return request.cookies.getAll() },
      setAll() { },
    },
  })

  const { data: { user }, error: authError } = await supabase.auth.getUser()

  console.log('[do-join] getUser result', {
    userId:    user?.id ?? null,
    userEmail: user?.email ?? null,
    authError: authError?.message ?? null,
  })

  if (authError || !user) {
    // Not authenticated yet — redirect back to join page
    console.log('[do-join] Not authenticated, redirecting to /join page')
    return NextResponse.redirect(`${origin}/join/${inviteCode}`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  // Look up trip by invite code
  const tripResult = await admin
    .from('trips')
    .select('id, name, status')
    .eq('invite_code', inviteCode)
    .single()

  console.log('[do-join] Trip lookup', {
    found:  !!tripResult?.data,
    status: tripResult?.data?.status ?? null,
    error:  tripResult?.error?.message ?? null,
  })

  const trip = tripResult?.data ?? null

  if (!trip || tripResult?.error) {
    return NextResponse.redirect(`${origin}/dashboard?joinError=trip_not_found`)
  }

  if (trip.status === 'archived') {
    return NextResponse.redirect(`${origin}/dashboard?joinError=trip_archived`)
  }

  // Check existing membership
  const existingResult = await admin
    .from('trip_members')
    .select('id')
    .eq('trip_id', trip.id)
    .eq('profile_id', user.id)
    .maybeSingle()

  console.log('[do-join] Membership check', {
    alreadyMember: !!existingResult?.data,
    error:         existingResult?.error?.message ?? null,
  })

  if (existingResult?.data) {
    console.log('[do-join] Already a member — redirecting to trip', trip.id)
    return NextResponse.redirect(`${origin}/trips/${trip.id}`)
  }

  // Insert membership
  const { error: insertError } = await admin
    .from('trip_members')
    .insert({ trip_id: trip.id, profile_id: user.id, role: 'player' })

  console.log('[do-join] Insert result', {
    success: !insertError,
    error:   insertError?.message ?? null,
  })

  if (insertError) {
    return NextResponse.redirect(`${origin}/dashboard?joinError=${encodeURIComponent(insertError.message)}`)
  }

  console.log('[do-join] ── SUCCESS ── redirecting to', `/trips/${trip.id}`)
  return NextResponse.redirect(`${origin}/trips/${trip.id}`)
}
