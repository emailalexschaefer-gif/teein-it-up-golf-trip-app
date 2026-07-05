// AUTH CALLBACK — exchanges the code for a session and sets cookies on the response.
//
// IMPORTANT: This route must NOT use createClient() from lib/supabase/server.ts.
// That function writes cookies via next/headers, which is read-only in Route Handlers.
// Instead we create a Supabase client inline that writes cookies onto the response object.

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code       = searchParams.get('code')
  const redirectTo = searchParams.get('redirectTo') ?? '/dashboard'
  const safePath   = redirectTo.startsWith('/') ? redirectTo : '/dashboard'

  console.log('[auth/callback] GET called', {
    hasCode:    !!code,
    redirectTo: safePath,
    origin,
  })

  if (!code) {
    console.log('[auth/callback] No code present — redirecting to login with error')
    return NextResponse.redirect(`${origin}/login?error=no_code`)
  }

  // Build the redirect response FIRST so we can attach cookies to it.
  const response = NextResponse.redirect(`${origin}${safePath}`)

  const supabaseUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[auth/callback] Missing Supabase env vars')
    return NextResponse.redirect(`${origin}/login?error=config`)
  }

  // Create a Supabase client that reads cookies from the request
  // and writes cookies directly onto the response object.
  // This is the correct pattern for Next.js App Router Route Handlers.
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        console.log('[auth/callback] setAll called with', cookiesToSet.length, 'cookies:',
          cookiesToSet.map(c => c.name))
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options)
        })
      },
    },
  })

  console.log('[auth/callback] Calling exchangeCodeForSession...')
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth/callback] exchangeCodeForSession ERROR:', {
      message: error.message,
      status:  error.status,
    })
    return NextResponse.redirect(`${origin}/login?error=exchange_failed`)
  }

  console.log('[auth/callback] exchangeCodeForSession SUCCESS', {
    userId: data.user?.id,
    email:  data.user?.email,
    // Log which cookies were set on the response
    responseCookies: response.cookies.getAll().map(c => c.name),
  })

  // Return the response — it now carries the session cookies.
  return response
}
