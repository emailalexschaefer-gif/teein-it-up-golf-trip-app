'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Step = 'checking' | 'form' | 'check_email' | 'rate_limited' | 'invalid'
type AuthMode = 'password' | 'magic'

export default function JoinForm() {
  const params     = useParams()
  const router     = useRouter()
  const inviteCode = (params.code as string)?.toUpperCase()

  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [authMode, setAuthMode] = useState<AuthMode>('password')
  const [loading, setLoading]   = useState(false)
  const [tripName, setTripName] = useState<string | null>(null)
  const [step, setStep]         = useState<Step>('checking')
  const [error, setError]       = useState<string | null>(null)

  const supabase = createClient()

  useEffect(() => {
    if (!inviteCode) { setStep('invalid'); return }

    // Check if the user is already logged in — if so, join immediately
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (user) {
        // Already authenticated — call join API directly, no email needed
        const res  = await fetch('/api/join', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ invite_code: inviteCode }),
        })
        const data = await res.json()
        if (res.ok) {
          router.replace(`/trips/${data.tripId}`)
          return
        }
      }

      // Not logged in — look up trip name for display
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db: any = supabase
      const result = await db
        .from('trips')
        .select('name, status')
        .eq('invite_code', inviteCode)
        .maybeSingle()

      if (!result.data || result.data.status === 'archived') {
        setStep('invalid')
      } else {
        setTripName(result.data.name)
        setStep('form')
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteCode])

  function isRateLimitError(msg: string): boolean {
    const l = msg.toLowerCase()
    return l.includes('rate limit') || l.includes('too many') ||
           l.includes('email rate') || l.includes('over the limit') || l.includes('429')
  }

  // The invite code travels inside the callback URL so it survives across browser contexts.
  // Supabase appends ?code=xxx — the callback reads both inviteCode and code,
  // exchanges the session, then redirects to /api/auth/do-join?inviteCode=XXX
  // which joins the trip server-side before sending the user to the trip page.
  function buildCallbackUrl(): string {
    return `${window.location.origin}/api/auth/callback?inviteCode=${encodeURIComponent(inviteCode)}`
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)

    // Try sign-in first (returning user)
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password })

    if (!signInErr) {
      // Signed in — join trip immediately then redirect
      const res  = await fetch('/api/join', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ invite_code: inviteCode }),
      })
      const data = await res.json()
      setLoading(false)
      if (res.ok) {
        router.push(`/trips/${data.tripId}`)
      } else {
        setError(data.error ?? 'Joined account but could not add to trip.')
        router.push('/dashboard')
      }
      return
    }

    // Sign-in failed — try sign-up (new user)
    const { error: signUpErr } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    })

    if (signUpErr) {
      setLoading(false)
      setError(signUpErr.message)
      return
    }

    // Signed up successfully — join trip and redirect
    const res  = await fetch('/api/join', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ invite_code: inviteCode }),
    })
    const data = await res.json()
    setLoading(false)
    if (res.ok) {
      router.push(`/trips/${data.tripId}`)
    } else {
      router.push('/dashboard')
    }
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)

    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        data: { full_name: name },
        emailRedirectTo: buildCallbackUrl(),
      },
    })

    setLoading(false)

    if (authError) {
      if (isRateLimitError(authError.message)) {
        setStep('rate_limited')
      } else {
        setError(authError.message)
      }
    } else {
      setStep('check_email')
    }
  }

  // ── Render states ──────────────────────────────────────────────────────────

  if (step === 'checking') {
    return (
      <div className="flex justify-center py-8">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    )
  }

  if (step === 'invalid') {
    return (
      <>
        <p className="text-3xl text-center mb-3">⛳</p>
        <h1 className="text-lg font-bold text-text text-center mb-2">Link not found</h1>
        <p className="text-text-muted text-sm text-center">
          This invite link is not valid or has expired.
        </p>
      </>
    )
  }

  if (step === 'check_email') {
    return (
      <>
        <p className="text-3xl text-center mb-3">📧</p>
        <h1 className="text-lg font-bold text-text text-center mb-2">Check your email</h1>
        <p className="text-text-muted text-sm text-center">
          We sent a sign-in link to <strong>{email}</strong>.
          Tap it to join <strong>{tripName}</strong>.
        </p>
        <p className="text-xs text-text-subtle text-center mt-3">
          The link will add you to the trip automatically.
        </p>
      </>
    )
  }

  if (step === 'rate_limited') {
    return (
      <>
        <p className="text-3xl text-center mb-3">⏱️</p>
        <h1 className="text-lg font-bold text-text text-center mb-2">Too many emails sent</h1>
        <p className="text-text-muted text-sm text-center mb-4">
          Please wait a few minutes and try again, or set a password to join instantly.
        </p>
        <div className="space-y-2">
          <button
            onClick={() => { setStep('form'); setAuthMode('password') }}
            className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-brand-700 transition-colors"
          >
            Set a password instead
          </button>
          <button
            onClick={() => { setStep('form'); setAuthMode('magic') }}
            className="w-full bg-surface-subtle text-text rounded-xl py-3 text-sm font-semibold hover:bg-surface transition-colors"
          >
            Try magic link again
          </button>
        </div>
      </>
    )
  }

  // ── Main form ──────────────────────────────────────────────────────────────

  return (
    <>
      <div className="text-center mb-6">
        <p className="text-2xl mb-1">⛳</p>
        <h1 className="text-xl font-bold text-text">You&apos;re invited</h1>
        {tripName && (
          <p className="text-text-muted text-sm mt-1">
            Join <strong className="text-text">{tripName}</strong>
          </p>
        )}
      </div>

      <form onSubmit={authMode === 'password' ? handlePassword : handleMagicLink} className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-text mb-1">
            Your name<span className="text-red-500 ml-0.5">*</span>
          </label>
          <input
            type="text" required autoComplete="name" value={name}
            onChange={(e) => setName(e.target.value)} placeholder="James Smith"
            className="w-full rounded-xl border border-surface-subtle px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text mb-1">
            Email<span className="text-red-500 ml-0.5">*</span>
          </label>
          <input
            type="email" required autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
            className="w-full rounded-xl border border-surface-subtle px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
          />
        </div>

        {authMode === 'password' && (
          <div>
            <label className="block text-sm font-medium text-text mb-1">
              Password<span className="text-red-500 ml-0.5">*</span>
            </label>
            <input
              type="password" required autoComplete="new-password" value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="Choose a password (min. 8 characters)"
              minLength={8}
              className="w-full rounded-xl border border-surface-subtle px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
        )}

        <button
          type="submit" disabled={loading || !tripName}
          className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50"
        >
          {loading ? 'Joining…' : authMode === 'password' ? 'Join trip' : 'Send sign-in link'}
        </button>
      </form>

      <div className="mt-4 text-center">
        <button
          type="button"
          onClick={() => { setAuthMode(authMode === 'password' ? 'magic' : 'password'); setError(null) }}
          className="text-sm text-text-muted hover:text-brand-600 transition-colors"
        >
          {authMode === 'password'
            ? 'Sign in with a magic link instead'
            : 'Set a password instead (no email needed)'}
        </button>
      </div>
    </>
  )
}
