// PKCE Auth Callback
//
// The invite code (if present) travels through the URL chain:
//   emailRedirectTo = /api/auth/callback?inviteCode=ABC123
//   Supabase appends: &code=xxx
//   This route reads both, exchanges the session, then joins the trip server-side.
//   Final redirect: /trips/[tripId]  (or /dashboard if no invite code)
//
// This survives mobile email clients opening links in a fresh browser context —
// no sessionStorage dependency.

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code       = searchParams.get('code')
  const inviteCode = searchParams.get('inviteCode')?.toUpperCase() ?? null

  console.log('[api/auth/callback] GET', {
    hasCode:    !!code,
    inviteCode,
    origin,
  })

  if (!code) {
    console.log('[api/auth/callback] No code — redirecting to /auth/callback for implicit handling')
    return NextResponse.redirect(`${origin}/auth/callback${request.nextUrl.search}`)
  }

  const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  // We build the final redirect destination before the session exchange
  // so we can write cookies onto that response object.
  const destination = inviteCode
    ? `${origin}/api/auth/do-join?inviteCode=${inviteCode}`
    : `${origin}/dashboard`

  const response = NextResponse.redirect(destination)

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        console.log('[api/auth/callback] Writing', cookiesToSet.length, 'cookies')
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options)
        })
      },
    },
  })

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[api/auth/callback] exchangeCodeForSession failed:', error.message)
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  console.log('[api/auth/callback] Session established', {
    userId:      data.user?.id,
    inviteCode,
    destination,
  })

  return response
}
