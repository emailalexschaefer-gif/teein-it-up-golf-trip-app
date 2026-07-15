import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const inviteCode = searchParams.get('inviteCode')?.toUpperCase()

  console.log('[do-join] ── START ──', {
    inviteCode,
    cookies: request.cookies.getAll().map((c: { name: string }) => c.name),
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

  // Read handicap from query params (passed through from join form or callback)
  const hcpRaw  = searchParams.get('handicap')
  const hcpNull = searchParams.get('noHandicap') === '1'
  let playing_handicap: number | null = null

  if (!hcpNull && hcpRaw !== null && hcpRaw !== '') {
    const parsed = parseFloat(hcpRaw)
    if (!isNaN(parsed)) playing_handicap = parsed
  }

  // Fallback: read from auth metadata (populated during signUp/OTP for email-confirm path)
  if (playing_handicap === null && !hcpNull) {
    const metaHcp     = user.user_metadata?.handicap
    const metaNoHcp   = user.user_metadata?.no_handicap
    if (metaNoHcp !== '1' && metaHcp && metaHcp !== '') {
      const parsed = parseFloat(String(metaHcp))
      if (!isNaN(parsed)) playing_handicap = parsed
    }
  }

  // Build insert row — only include playing_handicap if the value is set
  // (omitting it avoids schema cache errors if migration 013 hasn't been applied yet)
  const memberRow: Record<string, unknown> = {
    trip_id:    trip.id,
    profile_id: user.id,
    role:       'player',
  }
  if (playing_handicap !== null) {
    memberRow.playing_handicap = playing_handicap
  }

  const { error: insertError } = await admin
    .from('trip_members')
    .insert(memberRow)

  // Update profiles — only fill in missing data, never overwrite existing values
  const profileCheck = await admin.from('profiles').select('full_name, handicap').eq('id', user.id).single()
  const currentName: string    = profileCheck?.data?.full_name ?? ''
  const currentHcp:  unknown   = profileCheck?.data?.handicap
  const profileUpdate: Record<string, unknown> = {}

  // Only save handicap to profile if user has none yet (new user onboarding)
  if (playing_handicap !== null && (currentHcp === null || currentHcp === undefined)) {
    profileUpdate.handicap = playing_handicap
  }
  // Sync name from auth metadata if the profile still has the default empty name
  if (currentName === '' && user.user_metadata?.full_name) {
    profileUpdate.full_name = user.user_metadata.full_name
  }
  if (Object.keys(profileUpdate).length > 0) {
    await admin.from('profiles').update(profileUpdate).eq('id', user.id).then(() => {})
  }

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
