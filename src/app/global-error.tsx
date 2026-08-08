'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Next.js's root-level error boundary — catches any error that
 * propagates all the way up, including from the root layout itself.
 * This is deliberately minimal and self-contained: it replaces the
 * entire tree (including ReactQueryProvider) when active, so it can't
 * rely on React Query, the app's normal AppNav, or any other part of
 * the app still working. Its one job is guaranteeing a way out —
 * matching the explicit "the user should never be trapped in the app
 * because a data query failed" requirement, for the worst case where
 * something crashes badly enough to reach here at all.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
    } catch {
      // Even if signOut() itself fails, still navigate away — being
      // stuck on a broken page is worse than a hard redirect regardless
      // of the exact failure.
    }
    // A hard navigation, not router.push — this component may be
    // replacing a genuinely broken app tree, so it deliberately doesn't
    // depend on the Next.js router (or anything else) still working
    // correctly. This is the one guaranteed way out.
    window.location.href = '/login'
  }

  return (
    <html lang="en">
      <body style={{ background: '#faf6ed', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'sans-serif' }}>
        <div style={{ maxWidth: 360, textAlign: 'center' }}>
          <p style={{ fontSize: 18, fontWeight: 700, color: '#1a1a16', marginBottom: 8 }}>
            Something went wrong
          </p>
          <p style={{ fontSize: 14, color: '#7a7260', marginBottom: 24 }}>
            This page hit an unexpected error. You can try again, or sign out and start fresh.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              onClick={() => reset()}
              style={{
                padding: '12px 16px', borderRadius: 10, border: 'none',
                background: '#1a4731', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              style={{
                padding: '12px 16px', borderRadius: 10, border: '1.5px solid #d9c9a3',
                background: 'transparent', color: '#7a7260', fontWeight: 600, fontSize: 14,
                cursor: signingOut ? 'default' : 'pointer', opacity: signingOut ? 0.6 : 1,
              }}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
