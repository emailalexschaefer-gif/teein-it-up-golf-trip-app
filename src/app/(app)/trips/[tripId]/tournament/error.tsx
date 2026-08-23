'use client'

import { useEffect } from 'react'
import Link from 'next/link'

/**
 * Route-scoped error boundary for My HQ / My Golf specifically.
 *
 * P0 investigation (Round 1 completed + Round 2 LIVE crashes My HQ) —
 * traced hook ordering in TournamentControl.tsx (the new Side Games
 * Snapshot query sits correctly before every conditional return, not a
 * Rules-of-Hooks violation), the TournamentControl call site's props,
 * MyRoundSummary.tsx (rendered alongside it for an organiser who is
 * also playing — Darren's own exact situation), and every query in the
 * /tournament API route for round_id scoping (all correctly scoped).
 * None of these produced a definitive, reproducible smoking gun from
 * static reading alone in the time available.
 *
 * Rather than keep guessing against an explicit "do not guess"
 * instruction, this applies the same fix that worked precisely once
 * before on the scoring-page P0 crash: this app has no route-level
 * error boundaries anywhere except a root-level global-error.tsx that
 * shows no diagnostic information at all by design. Adding this
 * doesn't fix the crash — it's the mechanism needed to actually see
 * what it is on the next reproduction, exactly as it was last time.
 */
export default function TournamentRouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[tournament/My HQ route error]', error)
  }, [error])

  return (
    <div style={{ minHeight: '100vh', background: '#faf6ed', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 18, fontWeight: 700, color: '#1a1a16', marginBottom: 8 }}>
          My HQ hit a problem
        </p>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: '#7a7260', marginBottom: 16 }}>
          Your event data is safe — only this screen needs to reload.
        </p>

        {/* Deliberately shown to every user, not gated behind a dev
            flag — same reasoning as the scoring page's own version of
            this: there is currently no other way this specific
            exception reaches anyone who can act on it. */}
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
