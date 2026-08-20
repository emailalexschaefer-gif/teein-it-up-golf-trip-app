'use client'

import { useEffect } from 'react'
import Link from 'next/link'

/**
 * Route-scoped error boundary for the scoring page specifically.
 *
 * This project currently has NO error.tsx files anywhere except the
 * root-level global-error.tsx — meaning every single error, from any
 * component anywhere in the app, was escalating all the way past the
 * root layout to that generic boundary, which by design (it replaces
 * the entire tree, including providers) shows no diagnostic
 * information at all. That is the actual reason the P0 scoring crash
 * couldn't be pinned down from static code reading alone: there was no
 * mechanism anywhere in this app to surface what the real error even
 * was, to either a developer or the person hitting it.
 *
 * This is a genuine, narrowly-scoped fix for that gap, not a
 * speculative patch for the crash itself — it doesn't change any
 * scoring logic. What it does:
 *   1. Narrows the blast radius: an error here now only takes out the
 *      scoring route, not the entire app (nav, dashboard, everything).
 *   2. Surfaces error.message and error.digest directly on screen, so
 *      the next time this happens, a screenshot shows the actual
 *      exception rather than "Something went wrong" — the exact
 *      missing piece needed to diagnose the root cause definitively.
 *   3. console.error's the full error, so it also appears in Vercel's
 *      runtime logs for this request.
 */
export default function ScoringRouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[scoring route error]', error)
  }, [error])

  return (
    <div style={{ minHeight: '100vh', background: '#faf6ed', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 18, fontWeight: 700, color: '#1a1a16', marginBottom: 8 }}>
          Scoring hit a problem
        </p>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: '#7a7260', marginBottom: 16 }}>
          Your round data is safe — only this screen needs to reload.
        </p>

        {/* Deliberately shown to every user, not gated behind a dev
            flag — this app has no way to reach a developer's console
            during a live event, and a player/organiser screenshotting
            this text is currently the only practical way the actual
            error gets reported at all. */}
        <div style={{
          background: '#fff', border: '1px solid #e5d9c3', borderRadius: 10, padding: '12px 14px',
          marginBottom: 20, textAlign: 'left', wordBreak: 'break-word',
        }}>
          <p style={{ fontFamily: 'monospace', fontSize: 11.5, color: '#7a7260', lineHeight: 1.5 }}>
            {error.message || 'No error message available.'}
          </p>
          {error.digest && (
            <p style={{ fontFamily: 'monospace', fontSize: 10.5, color: '#a89e88', marginTop: 6 }}>
              Ref: {error.digest}
            </p>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            onClick={() => reset()}
            style={{
              padding: '12px 16px', borderRadius: 10, border: 'none',
              background: '#1a4731', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, cursor: 'pointer',
            }}
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            style={{
              display: 'block', padding: '12px 16px', borderRadius: 10, border: '1.5px solid #d9c9a3',
              background: 'transparent', color: '#7a7260', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14, textDecoration: 'none',
            }}
          >
            Back to My Events
          </Link>
        </div>
      </div>
    </div>
  )
}
