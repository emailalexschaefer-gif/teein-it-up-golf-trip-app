// Phase A-2 (performance) — public static resources that never need the
// middleware's Supabase auth round trip.
//
// Before this, every request that reached middleware — including every
// /brand/* icon, /images/* slideshow artwork, manifest.json and sw.js —
// paid for a `supabase.auth.getUser()` network call (plus two console.log
// lines) just to be told "this path is public anyway". That is a wasted
// round trip per asset, and on a slow/far link it delays first paint.
//
// ONLY files that are physically in /public and are not secret belong here.
// Nothing under /api, /trips, /dashboard, /admin, /me, /onboarding or any
// other app route may ever be listed: those must keep going through auth.
//
// The middleware `config.matcher` (middleware.ts) excludes the same
// prefixes so Next never invokes middleware for them at all. This helper
// is the second, in-function guard (it also covers /favicon*, which the
// matcher only excludes as exactly /favicon.ico), and it is the single
// place the unit tests pin the list down.

const PUBLIC_STATIC_PREFIXES = ['/brand/', '/images/', '/_next/'] as const
const PUBLIC_STATIC_EXACT = ['/manifest.json', '/sw.js', '/favicon.ico', '/robots.txt', '/sitemap.xml'] as const

export function isPublicStaticPath(pathname: string): boolean {
  if (PUBLIC_STATIC_EXACT.some(p => pathname === p)) return true
  if (pathname.startsWith('/favicon')) return true
  return PUBLIC_STATIC_PREFIXES.some(p => pathname.startsWith(p))
}
