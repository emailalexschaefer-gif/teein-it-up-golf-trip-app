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
//
// 30 Aug field-test bundle — the separate "GOLF EVENT APP" caption below
// the logo is removed: the actual crest artwork (logo-new.png, see
// BrandLogo.tsx) already has "GOLF EVENT APP" baked into the image
// itself, so this was a literal duplicate, not a design accent.
// marginBottom increased slightly (10 -> 18) to keep clear breathing
// room between the now-denser full crest image and the Sign In card
// beneath it, per the explicit "keep enough spacing" requirement.

import BrandLogo from '@/components/brand/BrandLogo'

export default function AuthBranding() {
  return (
    <div style={{ marginBottom: 18, textAlign: 'center' }}>
      <BrandLogo variant="full" priority />
    </div>
  )
}
