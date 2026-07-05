'use client'

// Auth Callback — client-side handler for magic link and OAuth redirects.
//
// WHY CLIENT-SIDE:
// Supabase magic links (signInWithOtp) redirect here with the session tokens
// in the URL hash fragment: /auth/callback#access_token=xxx&refresh_token=yyy
// Server-side Route Handlers never see hash fragments (they're browser-only).
// The browser Supabase client reads the hash automatically on initialisation
// via detectSessionFromUrl(), establishes the session, and we then redirect.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function AuthCallbackPage() {
  const router = useRouter()
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing')
  const [errorMsg, setErrorMsg] = useState<string>('')

  useEffect(() => {
    const supabase = createClient()

    console.log('[auth/callback] Client page mounted', {
      href:   window.location.href,
      hash:   window.location.hash.slice(0, 60) + (window.location.hash.length > 60 ? '...' : ''),
      search: window.location.search,
    })

    // Case 1: PKCE flow — ?code= in query string (e.g. password reset, OAuth)
    const params = new URLSearchParams(window.location.search)
    const code   = params.get('code')
    const redirectTo = params.get('redirectTo') ?? '/dashboard'

    if (code) {
      console.log('[auth/callback] Found ?code= — exchanging via PKCE')
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) {
          console.error('[auth/callback] exchangeCodeForSession error:', error.message)
          setErrorMsg(error.message)
          setStatus('error')
        } else {
          console.log('[auth/callback] PKCE exchange success — redirecting to', redirectTo)
          setStatus('success')
          router.replace(redirectTo)
        }
      })
      return
    }

    // Case 2: Implicit flow — tokens in hash fragment (magic links)
    // createBrowserClient calls detectSessionFromUrl() internally.
    // We just need to wait for onAuthStateChange to fire with SIGNED_IN.
    if (window.location.hash.includes('access_token')) {
      console.log('[auth/callback] Found #access_token — waiting for session via onAuthStateChange')

      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        console.log('[auth/callback] onAuthStateChange:', event, {
          hasSession: !!session,
          userId: session?.user?.id,
        })

        if (event === 'SIGNED_IN' && session) {
          console.log('[auth/callback] SIGNED_IN — redirecting to', redirectTo)
          setStatus('success')
          subscription.unsubscribe()
          router.replace(redirectTo)
        }
      })

      // Timeout fallback — if SIGNED_IN never fires within 5s
      setTimeout(() => {
        supabase.auth.getSession().then(({ data }) => {
          console.log('[auth/callback] Timeout check — session:', !!data.session)
          if (data.session) {
            setStatus('success')
            router.replace(redirectTo)
          } else {
            setErrorMsg('Session could not be established. Please try again.')
            setStatus('error')
          }
        })
      }, 5000)

      return
    }

    // Case 3: No code and no hash — callback reached with no auth data
    console.warn('[auth/callback] No code and no hash fragment found', {
      search: window.location.search,
      hash:   window.location.hash,
    })
    setErrorMsg('No authentication data found. Please try signing in again.')
    setStatus('error')
  }, [router])

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <p className="text-2xl mb-3">⚠️</p>
          <h1 className="text-lg font-bold text-text mb-2">Sign-in failed</h1>
          <p className="text-text-muted text-sm mb-4">{errorMsg}</p>
          <a href="/login" className="text-brand-600 text-sm hover:underline">Back to sign in</a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-text-muted text-sm">
          {status === 'success' ? 'Signed in — redirecting…' : 'Completing sign-in…'}
        </p>
      </div>
    </div>
  )
}
