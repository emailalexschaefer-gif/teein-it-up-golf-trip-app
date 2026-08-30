'use client'

// This page exists purely to catch any Supabase redirects that arrive
// with hash fragments (#access_token=...) from implicit-flow responses.
// For PKCE magic links, the server-side route at /api/auth/callback handles the exchange.
// This page handles the implicit fallback only.
//
// 30 Aug field-test bundle, P0 — password reset landing screen. Root
// cause, traced end to end per the explicit "Supabase recovery email →
// redirect URL → auth callback/session → PASSWORD_RECOVERY state/event
// → recovery UI" instruction:
//
// 1. This page read `redirectTo` from the query string, but the
//    server-side /api/auth/callback route (which forwards the request
//    here when there's no ?code=, i.e. the implicit-flow case a
//    recovery link commonly uses) forwards the ORIGINAL query string
//    verbatim — which carries `next=/reset-password`, never
//    `redirectTo`. That param was never actually present here, so this
//    always silently fell through to the /dashboard default —
//    genuinely present, provable bug, independent of anything else.
// 2. Detection used a blind 500ms setTimeout before checking
//    getSession() — a real race condition, not the Supabase-recommended
//    pattern for this exact scenario. Supabase fires a distinct
//    PASSWORD_RECOVERY auth event specifically for a recovery link,
//    separate from a normal SIGNED_IN — waiting for that event (via
//    onAuthStateChange) instead of guessing a fixed delay is both more
//    reliable and is what actually lets this page tell "this session is
//    a password recovery" apart from "this session is a coincidentally-
//    already-logged-in user," which the previous getSession()-only
//    check could never distinguish.
// 3. An expired/invalid recovery link delivers an error via the URL
//    hash (#error=access_denied&error_code=otp_expired&error_description=...),
//    which neither this page nor ResetPasswordForm previously checked
//    for at all — it would just silently fall through as "no session,"
//    with no useful message explaining why.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function AuthCallbackPage() {
  const router = useRouter()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()

    // Supabase error hash format for an expired/invalid/already-used
    // recovery (or any implicit-flow) link — checked first, before
    // waiting on any auth event that will never fire for a genuinely
    // dead link.
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const hashError = hashParams.get('error') || hashParams.get('error_code')
    if (hashError) {
      const description = hashParams.get('error_description')
      setErrorMessage(
        description ? decodeURIComponent(description.replace(/\+/g, ' ')) : 'This link has expired or is no longer valid.'
      )
      return
    }

    const params = new URLSearchParams(window.location.search)
    // P0 fix — was `redirectTo`, which is never actually present in
    // what /api/auth/callback forwards here; `next` is the actual
    // param name used throughout this app's own reset-password flow
    // (see ResetPasswordForm.tsx / resetPasswordForEmail's own
    // redirectTo construction).
    const next = params.get('next') ?? params.get('redirectTo') ?? '/dashboard'

    // P0 fix — PASSWORD_RECOVERY-aware, not a blind timer. onAuthStateChange
    // fires PASSWORD_RECOVERY specifically when detectSessionFromUrl()
    // finishes processing a recovery link's hash fragment; SIGNED_IN
    // covers every other implicit-flow case this page also still needs
    // to handle (magic-link sign-in, etc.) — both route to the same
    // `next` destination, since it's already correct for either case
    // (this app's other implicit-flow callers already set it
    // appropriately).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        router.replace(next)
      }
    })

    // Still need a bounded fallback — if detectSessionFromUrl() finds
    // nothing to process at all (not an error, just genuinely no token
    // in the URL), no auth event will ever fire and the spinner would
    // otherwise spin forever. Generous timeout (this only matters for
    // the genuinely-dead-end case, not the normal-speed happy path
    // above, which resolves via the event listener well before this).
    const fallback = setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        router.replace(next)
      } else {
        router.replace('/login?error=auth_failed')
      }
    }, 4000)

    return () => { subscription.unsubscribe(); clearTimeout(fallback) }
  }, [router])

  if (errorMessage) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <p className="text-lg font-semibold text-text mb-2">Link expired</p>
          <p className="text-sm text-text-muted mb-6">{errorMessage}</p>
          <a href="/reset-password" className="inline-block bg-brand-600 text-white rounded-xl px-5 py-2.5 text-sm font-semibold hover:bg-brand-700 transition-colors">
            Request a new link
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-gray-500">Completing sign-in…</p>
      </div>
    </div>
  )
}
