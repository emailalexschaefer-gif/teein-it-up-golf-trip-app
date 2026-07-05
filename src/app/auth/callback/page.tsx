'use client'

// This page exists purely to catch any Supabase redirects that arrive
// with hash fragments (#access_token=...) from implicit-flow responses.
// For PKCE magic links, the server-side route at /api/auth/callback handles the exchange.
// This page handles the implicit fallback only.

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function AuthCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    // The browser Supabase client (createBrowserClient) automatically calls
    // detectSessionFromUrl() on init, which handles the hash fragment.
    // We just wait for the session to be established then redirect.
    const supabase = createClient()

    const params = new URLSearchParams(window.location.search)
    const redirectTo = params.get('redirectTo') ?? '/dashboard'

    // Give detectSessionFromUrl() a moment to process, then check session
    const timer = setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        router.replace(redirectTo)
      } else {
        router.replace('/login?error=auth_failed')
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-gray-500">Completing sign-in…</p>
      </div>
    </div>
  )
}
