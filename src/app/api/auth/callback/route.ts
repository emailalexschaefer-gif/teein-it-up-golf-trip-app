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

import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code       = searchParams.get('code')
  const inviteCode = searchParams.get('inviteCode')?.toUpperCase() ?? null
  const next       = searchParams.get('next') ?? null   // e.g. /reset-password

  console.log('[api/auth/callback] GET', {
    hasCode:    !!code,
    inviteCode,
    next,
    origin,
  })

  if (!code) {
    console.log('[api/auth/callback] No code — redirecting to /auth/callback for implicit handling')
    return NextResponse.redirect(`${origin}/auth/callback${request.nextUrl.search}`)
  }

  const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  // Determine where to send the user after session is established.
  // Priority: inviteCode (join flow) > next param > dashboard
  const destination = inviteCode
    ? `${origin}/api/auth/do-join?inviteCode=${inviteCode}`
    : next
    ? `${origin}${next.startsWith('/') ? next : '/dashboard'}`
    : `${origin}/dashboard`

  const response = NextResponse.redirect(destination)

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
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
