'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Step = 'form' | 'check_email' | 'rate_limited' | 'invalid'
type AuthMode = 'magic' | 'password'

export default function JoinForm() {
  const params     = useParams()
  const inviteCode = (params.code as string)?.toUpperCase()

  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [authMode, setAuthMode] = useState<AuthMode>('magic')
  const [loading, setLoading]   = useState(false)
  const [tripName, setTripName] = useState<string | null>(null)
  const [step, setStep]         = useState<Step>('form')
  const [error, setError]       = useState<string | null>(null)

  const supabase = createClient()

  useEffect(() => {
    if (!inviteCode) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = supabase
    db
      .from('trips')
      .select('name, status')
      .eq('invite_code', inviteCode)
      .maybeSingle()
      .then((result: { data: { name: string; status: string } | null }) => {
        if (!result.data || result.data.status === 'archived') {
          setStep('invalid')
        } else {
          setTripName(result.data.name)
          // Store invite code so we can rejoin the trip after auth redirect
          sessionStorage.setItem('pendingInviteCode', inviteCode)
        }
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteCode])

  function isRateLimitError(msg: string): boolean {
    const lower = msg.toLowerCase()
    return (
      lower.includes('rate limit') ||
      lower.includes('too many') ||
      lower.includes('email rate') ||
      lower.includes('over the limit') ||
      lower.includes('429')
    )
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)

    const callbackUrl = `${window.location.origin}/api/auth/callback`

    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        data: { full_name: name },
        emailRedirectTo: callbackUrl,
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

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)

    // Try signing in first (existing user)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    if (!signInError) {
      // Signed in — redirect to dashboard (invite code stored in sessionStorage,
      // the dashboard or a post-auth hook picks it up)
      window.location.href = `${window.location.origin}/dashboard`
      return
    }

    // If sign-in failed because user doesn't exist, sign them up
    if (signInError.message.toLowerCase().includes('invalid login') ||
        signInError.message.toLowerCase().includes('no user')) {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } },
      })
      setLoading(false)
      if (signUpError) {
        setError(signUpError.message)
      } else {
        // Signed up and auto-signed in (email confirmation may be required)
        window.location.href = `${window.location.origin}/dashboard`
      }
    } else {
      setLoading(false)
      setError(signInError.message)
    }
  }

  // ── Render states ──────────────────────────────────────────────────────────

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
      </>
    )
  }

  if (step === 'rate_limited') {
    return (
      <>
        <p className="text-3xl text-center mb-3">⏱️</p>
        <h1 className="text-lg font-bold text-text text-center mb-2">Too many emails sent</h1>
        <p className="text-text-muted text-sm text-center mb-4">
          Too many sign-in emails have been sent recently. Please wait a few
          minutes and try again — or set a password to join instantly.
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

      <form onSubmit={authMode === 'magic' ? handleMagicLink : handlePassword} className="space-y-3">
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
              onChange={(e) => setPassword(e.target.value)} placeholder="Choose a password"
              minLength={8}
              className="w-full rounded-xl border border-surface-subtle px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
            <p className="text-xs text-text-subtle mt-1">Minimum 8 characters</p>
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
        )}

        <button
          type="submit" disabled={loading || !tripName}
          className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50"
        >
          {loading
            ? 'Joining…'
            : authMode === 'magic'
            ? 'Send sign-in link'
            : 'Join trip'}
        </button>
      </form>

      <div className="mt-4 text-center">
        <button
          type="button"
          onClick={() => {
            setAuthMode(authMode === 'magic' ? 'password' : 'magic')
            setError(null)
          }}
          className="text-sm text-text-muted hover:text-brand-600 transition-colors"
        >
          {authMode === 'magic'
            ? 'Set a password instead (no email needed)'
            : 'Send a magic link instead'}
        </button>
      </div>
    </>
  )
}
