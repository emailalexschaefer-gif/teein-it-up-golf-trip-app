'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import HandicapPrompt from './HandicapPrompt'

type Step = 'checking' | 'form' | 'needs_handicap' | 'check_email' | 'rate_limited' | 'invalid' | 'joining' | 'error'
type AuthMode = 'password' | 'magic'

/**
 * Item I — dynamic date range for the invitation panel. "12–13
 * September 2026" for a multi-day event, "18 September 2026" for a
 * single day, matching the brief's exact examples. Returns null (not
 * an empty string) when either date is missing, so the caller's own
 * conditional rendering correctly omits the whole row rather than
 * showing a broken partial date.
 */
function formatInviteDateRange(startDate: string | null, endDate: string | null): string | null {
  if (!startDate) return null
  const start = new Date(`${startDate}T00:00:00`)
  if (Number.isNaN(start.getTime())) return null
  const startMonth = start.toLocaleDateString('en-US', { month: 'long' })
  const year = start.getFullYear()

  if (!endDate || endDate === startDate) {
    return `${start.getDate()} ${startMonth} ${year}`
  }
  const end = new Date(`${endDate}T00:00:00`)
  if (Number.isNaN(end.getTime())) return `${start.getDate()} ${startMonth} ${year}`

  // Same month: "12-13 September 2026". Different month/year: spell out
  // both ends in full rather than guessing at a shorthand that could
  // misread across a month/year boundary.
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${start.getDate()}\u2013${end.getDate()} ${startMonth} ${year}`
  }
  const endMonth = end.toLocaleDateString('en-US', { month: 'long' })
  return `${start.getDate()} ${startMonth} ${year} \u2013 ${end.getDate()} ${endMonth} ${end.getFullYear()}`
}

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
  // Default to 'new' rather than 'existing' — the actual fix for the
  // unidentified-profile bug. Everything downstream (signInWithOtp's
  // options.data.full_name, do-join's existing-profile-name check) was
  // already correctly built; the gap was purely which form a brand-new
  // invitee saw FIRST. Most people opening an event invitation link for
  // the first time have never used this app and don't have a password
  // — landing them on the 'existing' (email + password only, no name
  // field) form by default meant the required Full Name field was only
  // ever reached if they proactively noticed and tapped "New to Teein'
  // It Up? Create an account" first, which "we should not depend on the
  // player discovering" rules out. An existing user who lands here now
  // sees an equally prominent "Already have an account? Sign in
  // instead" link (unchanged, already present) to reach their simpler
  // form in one tap — and even if an existing user somehow submitted
  // through the 'new' path anyway, do-join's own
  // `!profileResult?.data?.full_name` check still protects their
  // established name from being overwritten, unchanged from before.
  const [formPath, setFormPath]           = useState<'existing' | 'new'>('new')
  const [step, setStep]         = useState<Step>('checking')
  const [tripName, setTripName] = useState<string | null>(null)
  const [tripLogoUrl, setTripLogoUrl] = useState<string | null>(null)
  const [tripStartDate, setTripStartDate] = useState<string | null>(null)
  const [tripEndDate, setTripEndDate] = useState<string | null>(null)
  const [roundCount, setRoundCount] = useState<number | null>(null)
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

        const existingHcp = profileResult?.data?.handicap
        const hcpStatus   = profileResult?.data?.handicap_status ?? 'pending'

        // If handicap_status column doesn't exist yet, fall back to checking just the handicap value
        const hasAnsweredHandicap = hcpStatus === 'provided'
          || hcpStatus === 'no_official_handicap'
          || existingHcp !== null

        if (!hasAnsweredHandicap) {
          setStep('needs_handicap')
          return
        }

        // Handicap already on file — join directly
        setStep('joining')
        startJoinTimeout('Join timed out. Please try again or use the invite code on your dashboard.')
        window.location.href = buildDoJoinUrl()
        return
      }

      // Not logged in — fetch trip identity for the invitation panel.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db: any = supabase
      const result = await db
        .from('trips').select('id, name, status, logo_url, start_date, end_date')
        .eq('invite_code', inviteCode).maybeSingle()

      if (!result.data || result.data.status === 'archived') {
        setStep('invalid')
      } else {
        setTripName(result.data.name)
        setTripLogoUrl(result.data.logo_url ?? null)
        setTripStartDate(result.data.start_date ?? null)
        setTripEndDate(result.data.end_date ?? null)
        // Round count is a nice-to-have for the invitation panel, not
        // essential — a failure here (e.g. an RLS edge case on rounds
        // for an unauthenticated visitor) should never block the whole
        // invitation from rendering, matching "handle missing optional
        // data gracefully."
        try {
          const roundsResult = await db.from('rounds').select('id', { count: 'exact', head: true }).eq('trip_id', result.data.id)
          setRoundCount(typeof roundsResult.count === 'number' ? roundsResult.count : null)
        } catch { setRoundCount(null) }
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

  async function handleExistingSignIn(e: React.FormEvent) {
    e.preventDefault()
    setStep('joining')
    startJoinTimeout('Sign-in timed out. Please try again.')

    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password })

    if (!signInErr) {
      // Session established — hard redirect so do-join receives the cookies.
      // Same buildDoJoinUrl(), same do-join endpoint as every other path —
      // this is a second entry point into the one authoritative join, not
      // a second join implementation.
      clearJoinTimeout()
      window.location.href = buildDoJoinUrl()
      return
    }

    // Deliberately does NOT fall back to sign-up — the user told us they
    // already have an account by choosing this path. A failed sign-in
    // here is either a wrong password or genuinely no account with this
    // email, and the clearest thing to do is say so and point at the
    // other two paths that do handle those cases (new account, or magic
    // link, which works for an existing account with no password set).
    clearJoinTimeout()
    setErrorMsg(
      "We couldn't sign you in with that email and password. " +
      'Double-check them, or use "New to Teein\u2019 It Up?" below if you don\u2019t have an account yet, ' +
      'or try the magic link option if your account uses one.'
    )
    setStep('error')
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

    const { error: signUpErr } = await supabase.auth.signUp({
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
        inviteCode={inviteCode}
        onCancel={() => router.push('/dashboard')}
        onComplete={async (hcpVal, noHcp) => {
          setStep('joining')
          startJoinTimeout('Join timed out. Please try again.')

          // Save handicap to profile before joining
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const db: any = supabase
          const { data: { user } } = await supabase.auth.getUser()
          if (user) {
            // Try with handicap_status; fall back if column missing
            const profileData: Record<string, unknown> = {
              handicap: hcpVal,
            }
            let updateResult = await db.from('profiles')
              .update({ ...profileData, handicap_status: noHcp ? 'no_official_handicap' : 'provided' })
              .eq('id', user.id)
            if (updateResult.error) {
              const em: string = updateResult.error?.message ?? ''
              if (em.includes('handicap_status') || em.includes('schema cache')) {
                updateResult = await db.from('profiles').update(profileData).eq('id', user.id)
              }
            }
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
  // Two clear paths rather than one form that always shows every field —
  // the actual fix for "mainly presents a new-user registration form."
  // The invite has already answered "which trip?"; this only needs to
  // answer "who are you?" An existing user only ever sees email +
  // password (+ the magic-link toggle); a new user sees the full form.
  // Both still end up at the exact same buildDoJoinUrl() / do-join
  // endpoint used everywhere else in this file.

  return (
    <>
      {/* Invitation panel — matches the approved mock-up's dark/gold
          "YOU'RE INVITED TO" card. Sits inside the existing cream auth
          card (auth/layout.tsx, unchanged, shared by every auth route)
          rather than restructuring that shared layout for this one
          route — the background/branding/tagline it already provides
          match the mock-up closely enough that rebuilding the whole
          page shell wasn't worth the regression risk to login/signup/
          reset-password, which all inherit the same layout. Populated
          entirely from real trip data fetched above — nothing
          hardcoded, and every field is conditionally rendered so
          missing optional data (no logo, no rounds yet) degrades
          gracefully rather than showing a broken/empty state. */}
      {tripName && (
        <div style={{
          background: 'linear-gradient(135deg, #0f2d1c 0%, #1a4731 100%)',
          border: '1.5px solid #c9a84c', borderRadius: 16, padding: '18px 18px', marginBottom: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {tripLogoUrl ? (
              <img src={tripLogoUrl} alt="" style={{ width: 56, height: 56, borderRadius: 10, objectFit: 'cover', flexShrink: 0, border: '1px solid rgba(232,201,106,0.4)' }} />
            ) : (
              <div style={{
                width: 56, height: 56, borderRadius: 10, flexShrink: 0, border: '1px solid rgba(232,201,106,0.4)',
                background: 'rgba(232,201,106,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26,
              }}>⛳</div>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#e8c96a' }}>
                You&apos;re invited to
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 800, color: '#ffffff', lineHeight: 1.15, marginTop: 2 }}>
                {tripName}
              </div>
            </div>
          </div>
          {(formatInviteDateRange(tripStartDate, tripEndDate) || roundCount !== null) && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(232,201,106,0.2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {formatInviteDateRange(tripStartDate, tripEndDate) && (
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'rgba(245,230,184,0.85)' }}>
                  📅 {formatInviteDateRange(tripStartDate, tripEndDate)}
                </div>
              )}
              {roundCount !== null && roundCount > 0 && (
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'rgba(245,230,184,0.85)' }}>
                  🚩 {roundCount} Round{roundCount === 1 ? '' : 's'}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="text-center mb-6">
        <p className="text-2xl mb-1">⛳</p>
      </div>

      {formPath === 'existing' ? (
        <>
          <p className="text-sm font-semibold text-text mb-3">Already have an account?</p>
          <form onSubmit={authMode === 'password' ? handleExistingSignIn : handleMagicLink} className="space-y-3">
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
                <input type="password" required autoComplete="current-password" value={password}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                  placeholder="Your password"
                  className="w-full rounded-xl border border-surface-subtle px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600" />
              </div>
            )}

            <button type="submit"
              className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-brand-700 transition-colors">
              {authMode === 'password' ? 'Sign In & Join Trip' : 'Send sign-in link'}
            </button>
          </form>

          <div className="mt-3 text-center">
            <button type="button"
              onClick={() => { setAuthMode(authMode === 'password' ? 'magic' : 'password') }}
              className="text-sm text-text-muted hover:text-brand-600 transition-colors">
              {authMode === 'password' ? 'Email me a magic link instead' : 'Use my password instead'}
            </button>
          </div>

          <div className="mt-5 pt-4 border-t border-surface-subtle text-center">
            <button type="button"
              onClick={() => { setFormPath('new'); setAuthMode('password') }}
              className="text-sm text-text-muted hover:text-brand-600 transition-colors">
              New to Teein&apos; It Up? <span className="text-brand-600 font-medium">Create an account</span>
            </button>
          </div>
        </>
      ) : (
        <>
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
              {authMode === 'password' ? 'Create Account & Join Trip' : 'Send sign-in link'}
            </button>
          </form>

          <div className="mt-3 text-center">
            <button type="button"
              onClick={() => { setAuthMode(authMode === 'password' ? 'magic' : 'password') }}
              className="text-sm text-text-muted hover:text-brand-600 transition-colors">
              {authMode === 'password'
                ? 'Sign in with a magic link instead'
                : 'Set a password instead (no email needed)'}
            </button>
          </div>

          <div className="mt-5 pt-4 border-t border-surface-subtle text-center">
            <button type="button"
              onClick={() => setFormPath('existing')}
              className="text-sm text-text-muted hover:text-brand-600 transition-colors">
              Already have an account? <span className="text-brand-600 font-medium">Sign in instead</span>
            </button>
          </div>
        </>
      )}
    </>
  )
}
