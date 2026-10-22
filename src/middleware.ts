import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isPublicStaticPath } from '@/lib/auth/publicStaticPaths'
import { isPublicRoute } from '@/lib/auth/publicRoutes'

export async function middleware(request: NextRequest) {
  const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const { pathname }    = request.nextUrl

  // Phase A-2 — public static files never need an auth round trip (and the
  // per-request logging that used to run here, which also printed
  // cookie NAMES for every request, is removed).
  if (isPublicStaticPath(pathname)) {
    return NextResponse.next({ request })
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('[middleware] Missing Supabase env vars — passing through')
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
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

  const { data: { user } } = await supabase.auth.getUser()

  // Routes that do not require authentication
  // 30 Aug field-test bundle — PWA installability. manifest.json,
  // sw.js, and every /brand/ icon were all missing from this allowlist
  // — for anyone not yet logged in (exactly the "just joined via
  // invite, about to be offered Install" moment this whole feature is
  // for), every one of these requests was being redirected to /login
  // instead of returning the actual file. Chrome's own manifest/
  // service-worker fetches happen unauthenticated, automatically, in
  // the background — they were silently receiving a login-page
  // redirect instead of JSON/JS, which alone would have been enough to
  // break installability regardless of anything else being correct.
  const isPublic = isPublicRoute(pathname)

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(url)
  }

  if (user && (pathname === '/' || pathname === '/login')) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  // Phase A-2 — also skip middleware entirely for /brand/*, /images/*,
  // manifest.json and sw.js (public files, see publicStaticPaths.ts).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|brand/|images/|manifest\\.json|sw\\.js).*)'],
}
