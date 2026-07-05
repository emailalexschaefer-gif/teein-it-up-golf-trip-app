import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const { pathname }    = request.nextUrl

  // Log every request so we can trace the redirect chain
  console.log('[middleware]', request.method, pathname, {
    cookies: request.cookies.getAll().map(c => c.name),
  })

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('[middleware] Missing Supabase env vars — passing request through')
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        )
        supabaseResponse = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        )
      },
    },
  })

  // Do not add any logic between createServerClient and getUser()
  const { data: { user }, error: userError } = await supabase.auth.getUser()

  console.log('[middleware] getUser result', {
    pathname,
    userId:  user?.id ?? null,
    error:   userError?.message ?? null,
    // Show auth-related cookies specifically
    hasAuthCookie: request.cookies.getAll().some(c =>
      c.name.includes('auth') || c.name.includes('sb-')
    ),
  })

  const isPublic =
    pathname === '/' ||
    pathname === '/login' ||
    pathname.startsWith('/join/') ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon')

  if (!user && !isPublic) {
    console.log('[middleware] No user, protected route — redirecting to /login')
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(url)
  }

  if (user && (pathname === '/' || pathname === '/login')) {
    console.log('[middleware] User authenticated, on auth page — redirecting to /dashboard')
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)'],
}
