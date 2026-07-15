import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const inviteCode = searchParams.get('inviteCode')?.toUpperCase()

  console.log('[do-join] START', {
    inviteCode,
    cookies: request.cookies.getAll().map((c: { name: string }) => c.name),
  })

  if (!inviteCode) {
    return NextResponse.redirect(`${origin}/dashboard`)
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return request.cookies.getAll() }, setAll() {} } }
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser()

  console.log('[do-join] getUser', {
    userId: user?.id ?? null,
    authError: authError?.message ?? null,
  })

  if (authError || !user) {
    return NextResponse.redirect(`${origin}/join/${inviteCode}`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  // Look up trip
  const tripResult = await admin
    .from('trips')
    .select('id, name, status')
    .ilike('invite_code', inviteCode)
    .single()

  const trip = tripResult?.data ?? null

  console.log('[do-join] trip lookup', {
    found: !!trip,
    status: trip?.status ?? null,
    error: tripResult?.error?.message ?? null,
  })

  if (!trip || tripResult?.error) {
    return NextResponse.redirect(`${origin}/dashboard?joinError=trip_not_found`)
  }
  if (trip.status === 'archived') {
    return NextResponse.redirect(`${origin}/dashboard?joinError=trip_archived`)
  }

  // Already a member?
  const existing = await admin
    .from('trip_members')
    .select('id')
    .eq('trip_id', trip.id)
    .eq('profile_id', user.id)
    .maybeSingle()

  if (existing?.data) {
    console.log('[do-join] already a member')
    return NextResponse.redirect(`${origin}/trips/${trip.id}`)
  }

  // Read handicap from params or user metadata
  const hcpRaw  = searchParams.get('handicap')
  const hcpNull = searchParams.get('noHandicap') === '1'
  let playing_handicap: number | null = null

  if (!hcpNull && hcpRaw) {
    const n = parseFloat(hcpRaw)
    if (!isNaN(n)) playing_handicap = n
  }
  if (playing_handicap === null && !hcpNull) {
    const metaHcp = user.user_metadata?.handicap
    if (metaHcp) {
      const n = parseFloat(String(metaHcp))
      if (!isNaN(n)) playing_handicap = n
    }
  }

  // Insert membership — try with playing_handicap first, fall back without it
  const memberRow: Record<string, unknown> = {
    trip_id:    trip.id,
    profile_id: user.id,
    role:       'player',
  }
  if (playing_handicap !== null) memberRow.playing_handicap = playing_handicap

  let { error: insertError } = await admin.from('trip_members').insert(memberRow)

  // If playing_handicap column doesn't exist yet, retry without it
  if (insertError) {
    const m = insertError.message ?? ''
    if (m.includes('playing_handicap') || m.includes('schema cache')) {
      console.warn('[do-join] playing_handicap column missing — retrying without it')
      const { error: retryError } = await admin.from('trip_members').insert({
        trip_id: trip.id, profile_id: user.id, role: 'player',
      })
      insertError = retryError
    }
  }

  console.log('[do-join] insert result', {
    success: !insertError,
    error: insertError?.message ?? null,
  })

  if (insertError) {
    return NextResponse.redirect(`${origin}/dashboard?joinError=${encodeURIComponent(insertError.message)}`)
  }

  // Best-effort: sync profile name from metadata if missing
  const profileResult = await admin
    .from('profiles')
    .select('full_name, handicap')
    .eq('id', user.id)
    .single()

  const profileUpdate: Record<string, unknown> = {}
  if (!profileResult?.data?.full_name && user.user_metadata?.full_name) {
    profileUpdate.full_name = user.user_metadata.full_name
  }
  if (playing_handicap !== null && profileResult?.data?.handicap == null) {
    profileUpdate.handicap = playing_handicap
  }
  if (Object.keys(profileUpdate).length > 0) {
    await admin.from('profiles').update(profileUpdate).eq('id', user.id).then(() => {})
  }

  console.log('[do-join] SUCCESS — redirecting to trip', trip.id)
  return NextResponse.redirect(`${origin}/trips/${trip.id}`)
}
