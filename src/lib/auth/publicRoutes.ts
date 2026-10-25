// The routes reachable without signing in. Extracted from middleware.ts so the
// list is unit-testable. Release 3S adds ONLY the shared-presentation viewer
// (/s/) and its media endpoint (/api/s/); both authorise via an unguessable
// token checked server-side, never via a session.
export function isPublicRoute(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname.startsWith('/auth/') ||
    pathname === '/reset-password' ||
    pathname.startsWith('/join/') ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname === '/manifest.json' ||
    pathname === '/sw.js' ||
    pathname.startsWith('/brand/') ||
    pathname.startsWith('/s/') ||
    pathname.startsWith('/api/s/') ||
    // Package 1 (post-Lappen): the public live leaderboard and its data endpoint
    // (token-authorised, read-only).
    pathname.startsWith('/l/') ||
    pathname.startsWith('/api/l/')
  )
}
