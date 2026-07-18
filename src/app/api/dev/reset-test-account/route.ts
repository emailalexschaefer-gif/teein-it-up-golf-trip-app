// POST /api/dev/reset-test-account
// Server-side only — uses service-role key, never exposed to browser.
// Only works when ENABLE_TEST_ACCOUNT_RESET=true AND caller is the test email.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const TEST_EMAILS = ['teeinitupapp@gmail.com', 'teeinitupdaztest@gmail.com']

export async function POST(request: NextRequest) {
  // ── Guard 1: feature flag ────────────────────────────────────────────────
  if (process.env.ENABLE_TEST_ACCOUNT_RESET !== 'true') {
    return NextResponse.json({ error: 'Not available.' }, { status: 403 })
  }

  // ── Guard 2: authenticated caller ────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  // ── Guard 3: must be the exact test email ─────────────────────────────────
  if (!TEST_EMAILS.includes(user.email?.toLowerCase() ?? '')) {
    console.warn('[reset-test-account] Rejected — caller is not the test account', {
      callerEmail: user.email,
    })
    return NextResponse.json({ error: 'Not authorised.' }, { status: 403 })
  }

  // ── Guard 4: body must confirm the user ID matches ────────────────────────
  let body: { userId?: string } = {}
  try { body = await request.json() } catch { /* empty body ok */ }

  if (body.userId && body.userId !== user.id) {
    return NextResponse.json({ error: 'User ID mismatch.' }, { status: 403 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  try {
    // ── Step 1: Remove player memberships ────────────────────────────────
    const { error: memberError } = await admin
      .from('trip_members')
      .delete()
      .eq('profile_id', user.id)
      .eq('role', 'player')

    if (memberError) {
      console.error('[reset-test-account] trip_members delete failed', memberError)
      return NextResponse.json({ error: "We couldn't reset the test account. Please try again." }, { status: 500 })
    }

    // ── Step 2: Handle trips this user organises ──────────────────────────
    const { data: ownedTrips } = await admin
      .from('trips')
      .select('id, name')
      .eq('organiser_id', user.id)

    if (ownedTrips && ownedTrips.length > 0) {
      // Remove organiser membership rows
      await admin
        .from('trip_members')
        .delete()
        .eq('profile_id', user.id)
        .in('trip_id', ownedTrips.map((t: { id: string }) => t.id))

      // Delete test-owned trips (they are test data)
      await admin.from('trips').delete().eq('organiser_id', user.id)

      console.log('[reset-test-account] deleted owned trips', {
        count: ownedTrips.length,
        names: ownedTrips.map((t: { name: string }) => t.name),
      })
    }

    // ── Step 3: Delete profile row ────────────────────────────────────────
    await admin.from('profiles').delete().eq('id', user.id)

    // ── Step 4: Delete Supabase Auth user ────────────────────────────────
    const { error: authDeleteError } = await admin.auth.admin.deleteUser(user.id)

    if (authDeleteError) {
      console.error('[reset-test-account] auth.admin.deleteUser failed', authDeleteError)
      return NextResponse.json({ error: "We couldn't reset the test account. Please try again." }, { status: 500 })
    }

    console.log('[reset-test-account] SUCCESS', { userId: user.id })
    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error('[reset-test-account] unexpected error', err)
    return NextResponse.json({ error: "We couldn't reset the test account. Please try again." }, { status: 500 })
  }
}
