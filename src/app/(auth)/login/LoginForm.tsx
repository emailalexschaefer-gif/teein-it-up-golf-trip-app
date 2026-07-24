'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Mode = 'magic' | 'password' | 'signup' | 'check_email'

export default function LoginForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const redirectTo   = searchParams.get('redirectTo') || '/dashboard'
  const inviteCode   = searchParams.get('inviteCode') || ''

  // Support ?mode=signup|password|magic in URL
  const initialMode = (searchParams.get('mode') as Mode | null) ?? 'magic'

  const [mode, setMode]       = useState<Mode>(initialMode)
  const [email, setEmail]     = useState('')
  const [password, setPass]   = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg]         = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // Signup-specific state
  const [name, setName]       = useState('')
  const [confirm, setConfirm] = useState('')
  const [hcp, setHcp]         = useState('')
  const [noHcp, setNoHcp]         = useState(false)
  const [signedUpEmail, setSignedUpEmail] = useState('')
  const [resendLoading, setResendLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(false)
  const [resendMsg, setResendMsg] = useState<string | null>(null)

  const supabase = createClient()

  // Build a link that switches mode while preserving invite context
  function modeUrl(m: Mode) {
    const params = new URLSearchParams()
    params.set('mode', m)
    if (inviteCode) params.set('inviteCode', inviteCode)
    if (redirectTo && redirectTo !== '/dashboard') params.set('redirectTo', redirectTo)
    return `/login?${params.toString()}`
  }

  async function handleMagic(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setMsg(null)
    const callbackUrl = `${window.location.origin}/api/auth/callback`
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl },
    })
    setLoading(false)
    setMsg(error
      ? { type: 'err', text: error.message }
      : { type: 'ok', text: `Check your email — we sent a link to ${email}` })
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setMsg(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) {
      const isCredential = error.message.toLowerCase().includes('invalid login') ||
                           error.message.toLowerCase().includes('invalid credentials')
      setMsg({ type: 'err', text: isCredential
        ? 'Wrong password, or this account uses a magic link. Try magic link or reset your password.'
        : error.message })
    } else {
      router.push(redirectTo); router.refresh()
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)

    // Validate
    if (!name.trim())                          { setMsg({ type: 'err', text: 'Full name is required.' }); return }
    if (!email.trim())                         { setMsg({ type: 'err', text: 'Email is required.' }); return }
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email))  { setMsg({ type: 'err', text: 'Enter a valid email address.' }); return }
    if (password.length < 8)                   { setMsg({ type: 'err', text: 'Password must be at least 8 characters.' }); return }
    if (password !== confirm)                  { setMsg({ type: 'err', text: 'Passwords do not match.' }); return }
    let hcpVal: number | null = null
    if (!noHcp && hcp !== '') {
      const n = parseFloat(hcp)
      if (isNaN(n) || n < -10 || n > 54) {
        setMsg({ type: 'err', text: 'Handicap must be between -10 and 54.' })
        return
      }
      hcpVal = n
    }

    const handicapStatus = noHcp ? 'no_official_handicap' : hcpVal !== null ? 'provided' : 'pending'

    setLoading(true)
    const callbackUrl = inviteCode
      ? `${window.location.origin}/api/auth/callback?inviteCode=${encodeURIComponent(inviteCode)}`
      : `${window.location.origin}/api/auth/callback`

    const { data, error: signUpErr } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: callbackUrl,
        data: {
          full_name:       name.trim(),
          handicap:        hcpVal !== null ? String(hcpVal) : '',
          handicap_status: handicapStatus,
        },
      },
    })
    setLoading(false)

    // Log result for debugging — no passwords or tokens exposed
    console.log('[signup] result', {
      userId:          data?.user?.id ?? null,
      email:           data?.user?.email ?? null,
      sessionExists:   Boolean(data?.session),
      identitiesCount: data?.user?.identities?.length ?? null,
      error:           signUpErr ? { message: signUpErr.message, status: signUpErr.status } : null,
    })

    if (signUpErr) {
      const m = signUpErr.message.toLowerCase()
      const statusCode = (signUpErr as { status?: number }).status ?? 0

      let userMsg = signUpErr.message

      if (m.includes('already registered') || m.includes('already exists')) {
        userMsg = 'An account with this email already exists. Sign in instead.'
      } else if (m.includes('rate limit') || m.includes('email rate') || statusCode === 429 || m.includes('too many')) {
        userMsg = "Email limit reached \u2014 Supabase's free plan allows only 2 confirmation emails per hour across the project. Please wait and try again, or contact support."
      } else if (m.includes('smtp') || m.includes('email') || m.includes('send')) {
        userMsg = `Email delivery failed: ${signUpErr.message}. Please try again or use a different email address.`
      }

      setMsg({ type: 'err', text: userMsg })
      return
    }

    // Supabase silently returns success for already-registered emails when email confirmation
    // is enabled. Detect this via empty identities array — no email was sent.
    if (data.user && (data.user.identities?.length ?? 0) === 0) {
      setMsg({ type: 'err', text: 'An account with this email already exists. Sign in instead.' })
      return
    }

    if (data.session && data.user) {
      // Email confirmation disabled — session created immediately
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db: any = supabase
      // Try with handicap_status first; fall back without it if column missing
      const profileData: Record<string, unknown> = {
        id: data.user.id, email: email.trim(),
        full_name: name.trim(), handicap: hcpVal,
      }
      let upsertResult = await db.from('profiles').upsert(
        { ...profileData, handicap_status: handicapStatus },
        { onConflict: 'id' }
      )
      if (upsertResult.error) {
        const em: string = upsertResult.error?.message ?? ''
        if (em.includes('handicap_status') || em.includes('schema cache')) {
          // Column not yet in DB — upsert without it
          upsertResult = await db.from('profiles').upsert(profileData, { onConflict: 'id' })
        }
        if (upsertResult.error) {
          console.error('[signup] profile upsert failed:', upsertResult.error.message)
        }
      }

      if (inviteCode) {
        await fetch('/api/join', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invite_code: inviteCode, playing_handicap: hcpVal }),
        })
      }
      router.push(redirectTo); router.refresh()
    } else {
      // Email confirmation enabled — email was handed to the provider
      setSignedUpEmail(email.trim())
      setMode('check_email' as Mode)
    }
  }

  async function handleResend() {
    if (!signedUpEmail || resendCooldown) return
    setResendLoading(true); setResendMsg(null)
    const callbackUrl = `${window.location.origin}/api/auth/callback`
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: signedUpEmail,
      options: { emailRedirectTo: callbackUrl },
    })
    setResendLoading(false)
    if (error) {
      const m = error.message.toLowerCase()
      setResendMsg(m.includes('rate limit') || m.includes('too many')
        ? 'Email limit reached — please wait before requesting another link.'
        : `Could not resend: ${error.message}`)
    } else {
      setResendMsg('Confirmation link resent. Check your inbox.')
      setResendCooldown(true)
      setTimeout(() => setResendCooldown(false), 60_000)  // 60 s cooldown
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (mode === 'check_email') return (
    <>
      <p style={{ fontSize: 36, textAlign: 'center', marginBottom: 10 }}>📧</p>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: '#1a1a16', textAlign: 'center', marginBottom: 8 }}>
        Check your email
      </h1>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260', textAlign: 'center', marginBottom: 4 }}>
        We sent a confirmation link to <strong>{signedUpEmail}</strong>.
      </p>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#a89e88', textAlign: 'center', marginBottom: 16 }}>
        Click it to activate your account. If you don&apos;t see it, check your spam folder.
      </p>

      {resendMsg && (
        <p style={{
          fontFamily: 'var(--font-body)', fontSize: 12,
          color: resendMsg.includes('resent') || resendMsg.includes('sent') ? '#166534' : '#b91c1c',
          textAlign: 'center', marginBottom: 12,
        }}>{resendMsg}</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          type="button" disabled={resendLoading || resendCooldown}
          onClick={handleResend}
          style={{
            width: '100%', padding: '11px 16px', borderRadius: 10,
            cursor: (resendLoading || resendCooldown) ? 'not-allowed' : 'pointer',
            background: (resendLoading || resendCooldown) ? '#e0ddd8' : '#f8f4eb',
            border: '1.5px solid #d9c9a3',
            fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#1a4731',
          }}
        >
          {resendLoading ? 'Sending…' : resendCooldown ? 'Link sent — wait 60s before resending' : 'Resend confirmation email'}
        </button>
        <button
          type="button"
          onClick={() => { setMode('signup'); setResendMsg(null) }}
          style={{
            width: '100%', padding: '11px 16px', borderRadius: 10,
            border: '1.5px solid #d9c9a3', background: 'transparent',
            cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 13,
            fontWeight: 600, color: '#7a7260',
          }}
        >
          Use a different email
        </button>
        <Link href={modeUrl('password')} style={{
          display: 'block', textAlign: 'center', marginTop: 4,
          fontFamily: 'var(--font-body)', fontSize: 13, color: '#a89e88', textDecoration: 'none',
        }}>
          Back to sign in
        </Link>
      </div>
    </>
  )

  if (mode === 'signup') return (
    <>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: '#1a1a16', marginBottom: 4 }}>
        Create account
      </h1>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260', marginBottom: 20 }}>
        Run your golf event like a pro.
      </p>

      {msg && (
        <div style={{
          marginBottom: 14, padding: '10px 14px', borderRadius: 10,
          background: msg.type === 'ok' ? '#f0fdf4' : '#fef2f2',
          border: `1.5px solid ${msg.type === 'ok' ? '#86efac' : '#fca5a5'}`,
          fontFamily: 'var(--font-body)', fontSize: 13,
          color: msg.type === 'ok' ? '#166534' : '#b91c1c',
        }}>{msg.text}</div>
      )}

      <form onSubmit={handleSignup} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SignupField label="Full name" required>
          <SInput type="text" required autoComplete="name" maxLength={80}
            value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            placeholder="James Smith" />
        </SignupField>

        <SignupField label="Email address" required>
          <SInput type="email" required autoComplete="email"
            value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            placeholder="you@example.com" />
        </SignupField>

        <SignupField label="Password" required hint="Minimum 8 characters">
          <SInput type="password" required autoComplete="new-password" minLength={8}
            value={password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPass(e.target.value)}
            placeholder="••••••••" />
        </SignupField>

        <SignupField label="Confirm password" required>
          <SInput type="password" required autoComplete="new-password"
            value={confirm} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirm(e.target.value)}
            placeholder="••••••••" />
        </SignupField>

        <SignupField label="Golf handicap" hint="Your default handicap for future trips and events.">
          {!noHcp && (
            <SInput type="number" min={-10} max={54} step={0.1}
              value={hcp} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHcp(e.target.value)}
              placeholder="e.g. 14 or 14.5" style={{ marginBottom: 8 }} />
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={noHcp}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setNoHcp(e.target.checked); if (e.target.checked) setHcp('') }} />
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260' }}>
              I don&apos;t have an official handicap
            </span>
          </label>
        </SignupField>

        <button type="submit" disabled={loading} style={{
          width: '100%', padding: '13px 20px', borderRadius: 12, border: 'none',
          cursor: loading ? 'not-allowed' : 'pointer',
          background: loading ? '#9db8a8' : 'linear-gradient(135deg, #2d7a52, #1a4731)',
          fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 700, color: '#ffffff',
          boxShadow: loading ? 'none' : '0 3px 12px rgba(26,71,49,0.35)',
        }}>
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260', textAlign: 'center', marginTop: 16 }}>
        Already have an account?{' '}
        <Link href={modeUrl('password')} style={{ color: '#1a4731', fontWeight: 600, textDecoration: 'none' }}>
          Sign in
        </Link>
      </p>
    </>
  )

  // Sign-in modes (magic / password)
  return (
    <>
      <h1 className="text-xl font-bold text-text mb-1">Sign in</h1>
      <p className="text-text-muted text-sm mb-6">
        {mode === 'magic'
          ? "We'll email you a secure sign-in link."
          : 'Sign in with your email and password.'}
      </p>

      <form onSubmit={mode === 'magic' ? handleMagic : handlePassword} className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-text mb-1">
            Email<span className="text-red-500 ml-0.5">*</span>
          </label>
          <input
            type="email" required autoComplete="email" value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-xl border border-surface-subtle px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
          />
        </div>

        {mode === 'password' && (
          <div>
            <label className="block text-sm font-medium text-text mb-1">
              Password<span className="text-red-500 ml-0.5">*</span>
            </label>
            <input
              type="password" required autoComplete="current-password" value={password}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPass(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-xl border border-surface-subtle px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </div>
        )}

        {msg && (
          <div className={`rounded-xl px-4 py-3 text-sm ${
            msg.type === 'ok' ? 'bg-brand-50 text-brand-600' : 'bg-red-50 text-red-600'
          }`}>
            {msg.text}
            {msg.type === 'err' && mode === 'password' && (
              <div className="mt-2">
                <Link href="/reset-password" className="underline font-medium hover:opacity-80">
                  Set or reset your password →
                </Link>
              </div>
            )}
          </div>
        )}

        <button
          type="submit" disabled={loading}
          className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50"
        >
          {loading ? 'Signing in…' : mode === 'magic' ? 'Send sign-in link' : 'Sign in'}
        </button>
      </form>

      <div className="mt-4 space-y-2 text-center">
        <div>
          <button
            type="button"
            onClick={() => { setMode(mode === 'magic' ? 'password' : 'magic'); setMsg(null) }}
            className="text-sm text-text-muted hover:text-brand-600 transition-colors"
          >
            {mode === 'magic' ? 'Sign in with password instead' : 'Sign in with a magic link instead'}
          </button>
        </div>
        {mode === 'password' && (
          <div>
            <Link href="/reset-password" className="text-sm text-text-muted hover:text-brand-600 transition-colors">
              Forgot password / set a password
            </Link>
          </div>
        )}
        <div>
          {/* This now navigates to ?mode=signup which renders the signup form in this same card */}
          <a
            href={modeUrl('signup')}
            className="text-sm text-text-muted hover:text-brand-600 transition-colors"
          >
            New to Teein&apos; It Up? Create an account
          </a>
        </div>
      </div>
    </>
  )
}

// Signup form helpers
function SignupField({ label, required, hint, children }: React.PropsWithChildren<{
  label: string; required?: boolean; hint?: string
}>) {
  return (
    <div>
      <label style={{
        display: 'block', fontFamily: 'var(--font-body)',
        fontSize: 11, fontWeight: 700, color: '#7a7260',
        letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 5,
      }}>
        {label}{required && <span style={{ color: '#ef4444', marginLeft: 3 }}>*</span>}
      </label>
      {hint && <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#a89e88', marginBottom: 5 }}>{hint}</p>}
      {children}
    </div>
  )
}

function SInput({ style, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  const base: React.CSSProperties = {
    width: '100%', borderRadius: 10, border: '1.5px solid #d9c9a3',
    padding: '11px 14px', fontSize: 14, fontFamily: 'var(--font-body)',
    color: '#1a1a16', background: '#ffffff', outline: 'none', boxSizing: 'border-box',
  }
  return <input style={{ ...base, ...style }} {...props} />
}
