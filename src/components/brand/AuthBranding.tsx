// Shared branding block for every unauthenticated route: cold load, direct
// /login, post-logout, magic-link and password forms, and the root `/`
// redirect target. One implementation, used everywhere — there is no
// second login/landing component anywhere in this project (verified: only
// one (auth) route group, no middleware, no duplicate layout).
//
// Deliberately a Server Component (no 'use client' here) so the logo is
// part of the initial server-rendered HTML — it does not depend on
// useEffect, auth-state resolution, localStorage, or any client-only
// hydration step to appear. BrandLogo itself is a Client Component only
// because of its onError fallback, but Next.js still renders that Image
// tag into the server HTML during SSR; the client-side part is purely the
// (rare) failure fallback, not the primary render path.

import BrandLogo from '@/components/brand/BrandLogo'

export default function AuthBranding() {
  return (
    <div style={{ marginBottom: 10, textAlign: 'center' }}>
      <BrandLogo variant="full" priority />
      <p style={{
        fontFamily: 'var(--font-body)',
        color: 'rgba(245,230,184,0.45)',
        fontSize: 10, marginTop: 6,
        letterSpacing: 2.5, textTransform: 'uppercase',
      }}>Golf Event App</p>
    </div>
  )
}
