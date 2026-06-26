// ─────────────────────────────────────────────────────────────────────────────
// AUTH CALLBACK — handles magic link redirects from Supabase
// Exchanges the auth code for a session and redirects appropriately.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code        = searchParams.get('code')
  const redirectTo  = searchParams.get('redirectTo') ?? '/dashboard'

  if (code) {
    const supabase = createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Ensure the redirect path starts with /
      const safePath = redirectTo.startsWith('/') ? redirectTo : '/dashboard'
      return NextResponse.redirect(`${origin}${safePath}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`)
}
