// PKCE Auth Callback — server-side session exchange for magic links and OAuth.
//
// Flow:
// 1. User calls signInWithOtp() on the client → @supabase/ssr stores code_verifier in a cookie
// 2. Supabase verifies the OTP and redirects here with ?code=xxx appended
// 3. This route reads the ?code and the code_verifier cookie, exchanges for a session
// 4. Session cookies are written onto the response, browser is redirected to the app
//
// The Supabase client is created INLINE here (not via lib/supabase/server.ts)
// so that cookies are written directly onto the response object, not via next/headers.

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  console.log('[api/auth/callback] GET', {
    hasCode: !!code,
    origin,
    allParams: Object.fromEntries(searchParams),
  })

  if (!code) {
    // No code — Supabase may have used implicit flow; send to client handler
    console.log('[api/auth/callback] No code — redirecting to /auth/callback for implicit handling')
    return NextResponse.redirect(`${origin}/auth/callback${request.nextUrl.search}`)
  }

  const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  // Build the redirect response first so we can write cookies onto it
  const response = NextResponse.redirect(`${origin}/dashboard`)

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        // Read cookies from the incoming request (includes the code_verifier)
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        // Write session cookies onto the response the browser will receive
        console.log('[api/auth/callback] Writing', cookiesToSet.length, 'cookies to response')
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options)
        })
      },
    },
  })

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[api/auth/callback] exchangeCodeForSession failed:', {
      message: error.message,
      status:  error.status,
    })
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  console.log('[api/auth/callback] Session established', {
    userId: data.user?.id,
    email:  data.user?.email,
  })

  // Return the response — it carries the session cookies
  return response
}
