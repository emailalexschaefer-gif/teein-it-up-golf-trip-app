'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import HandicapPrompt from './HandicapPrompt'

type Step = 'checking' | 'form' | 'needs_handicap' | 'check_email' | 'rate_limited' | 'invalid' | 'joining' | 'error'
type AuthMode = 'password' | 'magic'

export default function JoinForm() {
  const params     = useParams()
  const router     = useRouter()
  const inviteCode = (params.code as string)?.toUpperCase()

  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [password, setPassword]           = useState('')
  const [handicap, setHandicap]           = useState('')
  const [noHandicap, setNoHandicap]       = useState(false)
  const [authMode, setAuthMode]           = useState<AuthMode>('password')
  const [step, setStep]         = useState<Step>('checking')
  const [tripName, setTripName] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string>('')

  // Timeout guard — never spin forever
  const joinTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const supabase = createClient()

  function startJoinTimeout(message: string) {
    joinTimeoutRef.current = setTimeout(() => {
      setErrorMsg(message)
      setStep('error')
    }, 12000) // 12 seconds
  }

  function clearJoinTimeout() {
    if (joinTimeoutRef.current) clearTimeout(joinTimeoutRef.current)
  }

  useEffect(() => {
    if (!inviteCode) { setStep('invalid'); return }

    supabase.auth.getUser().then(async ({ data: { user } }: { data: { user: { id: string } | null } }) => {
      if (user) {
        // Already logged in — check if they have a handicap set
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db: any = supabase
        const profileResult = await db
          .from('profiles')
          .select('handicap, handicap_status, full_name')
          .eq('id', user.id)
          .single()

        const existingHcp    = profileResult?.data?.handicap
        const hcpStatus      = profileResult?.data?.handicap_status ?? 'pending'
        // Only prompt if they've never answered the handicap question.
        // 'provided' = has a value, 'no_official_handicap' = explicitly declined.
        // Both skip the prompt. Only 'pending' (never answered) shows it.
        if (hcpStatus === 'pending' && existingHcp === null) {
          setStep('needs_handicap')
          return
        }

        // Handicap already on file — join directly
        setStep('joining')
        startJoinTimeout('Join timed out. Please try again or use the invite code on your dashboard.')
        window.location.href = buildDoJoinUrl()
        return
      }

      // Not logged in — fetch trip name for display
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db: any = supabase
      const result = await db
        .from('trips').select('name, status')
        .eq('invite_code', inviteCode).maybeSingle()

      if (!result.data || result.data.status === 'archived') {
        setStep('invalid')
      } else {
        setTripName(result.data.name)
        setStep('form')
      }
    })

    return () => clearJoinTimeout()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteCode])

  function isRateLimitError(msg: string) {
    const l = msg.toLowerCase()
    return l.includes('rate limit') || l.includes('too many') ||
           l.includes('email rate') || l.includes('over the limit') || l.includes('429')
  }

  function buildCallbackUrl() {
    const base = `${window.location.origin}/api/auth/callback?inviteCode=${encodeURIComponent(inviteCode)}`
    if (noHandicap) return `${base}&noHandicap=1`
    if (handicap)   return `${base}&handicap=${encodeURIComponent(handicap)}`
    return base
  }

  function buildDoJoinUrl() {
    const base = `/api/auth/do-join?inviteCode=${encodeURIComponent(inviteCode)}`
    if (noHandicap) return `${base}&noHandicap=1`
    if (handicap)   return `${base}&handicap=${encodeURIComponent(handicap)}`
    return base
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault()
    setStep('joining')
    startJoinTimeout('Sign-in timed out. Please try again.')

    // ── Step 1: try signing in (returning user with a password) ───────────────
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password })

    if (!signInErr) {
      // Session established — hard redirect so do-join receives the cookies.
      clearJoinTimeout()
      window.location.href = buildDoJoinUrl()
      return
    }

    // ── Step 2: sign-in failed — determine why ────────────────────────────────
    // "Invalid login credentials" can mean:
    //   A) Wrong password for an existing password account
    //   B) Account exists but was created via magic link (no password set)
    //   C) Email doesn't exist at all
    // We can't distinguish A from B/C here, so we attempt signUp.
    // Supabase returns "User already registered" if the email already exists.

    const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name,
          handicap:  (!noHandicap && handicap !== '') ? handicap : '',
          no_handicap: noHandicap ? '1' : '',
        },
      },
    })

    // ── "User already registered" — email exists, no password (magic-link account) ──
    if (signUpErr) {
      clearJoinTimeout()
      const msg = signUpErr.message.toLowerCase()
      if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('email address is already')) {
        setErrorMsg(
          'This email uses magic-link sign-in and has no password. ' +
          'Use the magic link option below, or tap "Set a password" to create one.'
        )
      } else {
        setErrorMsg(signUpErr.message)
      }
      setStep('error')
      return
    }

    // ── signUp returned no error — check if a session was actually established ──
    // If email confirmation is required in Supabase, signUp succeeds but no session
    // is created. We must not redirect to do-join without a session.
    const { data: { user: newUser } } = await supabase.auth.getUser()

    if (!newUser) {
      // Email confirmation is enabled — user must confirm before joining.
      // Show "check your email" screen rather than hanging.
      clearJoinTimeout()
      setStep('check_email')
      return
    }

    // Session confirmed — hard redirect to do-join.
    clearJoinTimeout()
    window.location.href = buildDoJoinUrl()
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setStep('joining')
    startJoinTimeout('Sending email timed out. Please try again.')

    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        data: {
          full_name: name,
          handicap:  (!noHandicap && handicap !== '') ? handicap : '',
          no_handicap: noHandicap ? '1' : '',
        },
        emailRedirectTo: buildCallbackUrl(),
      },
    })

    clearJoinTimeout()

    if (authError) {
      if (isRateLimitError(authError.message)) {
        setStep('rate_limited')
      } else {
        setErrorMsg(authError.message)
        setStep('error')
      }
    } else {
      setStep('check_email')
    }
  }

  // ── Render states ──────────────────────────────────────────────────────────

  if (step === 'checking' || step === 'joining') {
    const label = step === 'joining' ? 'Joining trip…' : 'Loading…'
    return (
      <div className="flex flex-col items-center py-10 gap-4">
        <div className="w-10 h-10 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
        <p className="text-sm text-text-muted">{label}</p>
      </div>
    )
  }

  if (step === 'error') {
    return (
      <>
        <p className="text-3xl text-center mb-3">⚠️</p>
        <h1 className="text-lg font-bold text-text text-center mb-2">Something went wrong</h1>
        <p className="text-text-muted text-sm text-center mb-4">{errorMsg}</p>
        <div className="space-y-2">
          <button
            onClick={() => { setStep('form'); setErrorMsg('') }}
            className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-brand-700 transition-colors"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="block text-center text-sm text-text-muted hover:text-brand-600 transition-colors py-2"
          >
            Go to dashboard
          </a>
        </div>
      </>
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
        <p className="text-text-muted text-sm text-center mb-1">
          We sent a sign-in link to <strong>{email}</strong>.
        </p>
        <p className="text-text-muted text-sm text-center">
          Tap it to join <strong>{tripName}</strong>.
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
          Please wait a few minutes, or set a password to join instantly.
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
            className="w-full bg-surface-subtle text-text rounded-xl py-3 text-sm font-semibold transition-colors"
          >
            Try magic link again
          </button>
        </div>
      </>
    )
  }

  // ── Handicap prompt for existing logged-in users ──────────────────────────

  if (step === 'needs_handicap') {
    return (
      <HandicapPrompt
        loading={false}
        onContinue={async (hcpVal, declined) => {
          setStep('joining')
          startJoinTimeout('Join timed out. Please try again.')

          // Save handicap + handicap_status to profile before joining
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const db: any = supabase
          const { data: { user } } = await supabase.auth.getUser()
          if (user) {
            await db.from('profiles').update({
              handicap:        hcpVal,
              handicap_status: declined ? 'no_official_handicap' : 'provided',
            }).eq('id', user.id)
          }

          clearJoinTimeout()
          const base = `/api/auth/do-join?inviteCode=${encodeURIComponent(inviteCode)}`
          const url  = hcpVal !== null ? `${base}&handicap=${hcpVal}` : `${base}&noHandicap=1`
          window.location.href = url
        }}
      />
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
          <input type="text" required autoComplete="name" value={name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} placeholder="James Smith"
            className="w-full rounded-xl border border-surface-subtle px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600" />
        </div>

        <div>
          <label className="block text-sm font-medium text-text mb-1">
            Email<span className="text-red-500 ml-0.5">*</span>
          </label>
          <input type="email" required autoComplete="email" value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} placeholder="you@example.com"
            className="w-full rounded-xl border border-surface-subtle px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600" />
        </div>

        {authMode === 'password' && (
          <div>
            <label className="block text-sm font-medium text-text mb-1">
              Password<span className="text-red-500 ml-0.5">*</span>
            </label>
            <input type="password" required autoComplete="new-password" value={password}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
              placeholder="Choose a password (min. 8 characters)" minLength={8}
              className="w-full rounded-xl border border-surface-subtle px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600" />
          </div>
        )}

        {/* Handicap field */}
        <div>
          <label className="block text-sm font-medium text-text mb-1">
            Your golf handicap<span className="text-red-500 ml-0.5">*</span>
          </label>
          <p className="text-xs text-text-muted mb-2">
            Your default handicap for future trips and events.
          </p>
          {!noHandicap && (
            <input
              type="number" min="-10" max="54" step="0.1"
              value={handicap}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHandicap(e.target.value)}
              placeholder="e.g. 14 or 14.5"
              disabled={noHandicap}
              className="w-full rounded-xl border border-surface-subtle px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 mb-2"
            />
          )}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={noHandicap}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setNoHandicap(e.target.checked); if (e.target.checked) setHandicap('') }}
              className="rounded"
            />
            <span className="text-sm text-text-muted">No official handicap</span>
          </label>
        </div>

        <button type="submit"
          className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-brand-700 transition-colors">
          {authMode === 'password' ? 'Join trip' : 'Send sign-in link'}
        </button>
      </form>

      <div className="mt-4 text-center">
        <button type="button"
          onClick={() => { setAuthMode(authMode === 'password' ? 'magic' : 'password') }}
          className="text-sm text-text-muted hover:text-brand-600 transition-colors">
          {authMode === 'password'
            ? 'Sign in with a magic link instead'
            : 'Set a password instead (no email needed)'}
        </button>
      </div>
    </>
  )
}
