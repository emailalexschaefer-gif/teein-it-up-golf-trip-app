'use client'

import React, { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Step = 'form' | 'check_email'

export default function SignupForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const supabase     = createClient()

  // Preserve invite code through signup so we can join after account creation
  const inviteCode = searchParams.get('inviteCode') ?? ''
  const redirectTo = searchParams.get('redirectTo') ?? '/dashboard'

  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [password, setPass]     = useState('')
  const [confirm, setConfirm]   = useState('')
  const [hcp, setHcp]           = useState('')
  const [noHcp, setNoHcp]       = useState(false)
  const [step, setStep]         = useState<Step>('form')
  const [loading, setLoading]   = useState(false)
  const [errorMsg, setError]    = useState('')

  // Derived handicap value: null when "no official handicap" OR blank
  const handicapVal: number | null = noHcp ? null
    : hcp === '' ? null
    : parseFloat(hcp)

  // handicap_status for the profiles row
  const handicapStatus: 'provided' | 'no_official_handicap' | 'pending' =
    noHcp ? 'no_official_handicap'
    : handicapVal !== null ? 'provided'
    : 'pending'

  function validate(): string | null {
    if (!name.trim())                           return 'Full name is required.'
    if (!email.trim())                          return 'Email is required.'
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email))   return 'Enter a valid email address.'
    if (password.length < 8)                    return 'Password must be at least 8 characters.'
    if (password !== confirm)                   return 'Passwords do not match.'
    if (!noHcp && hcp !== '') {
      const n = parseFloat(hcp)
      if (isNaN(n) || n < -10 || n > 54)       return 'Handicap must be between -10 and 54.'
    }
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const err = validate()
    if (err) { setError(err); return }
    setLoading(true); setError('')

    // Build the redirect URL — preserves invite code so do-join fires after email confirmation
    const base = `${window.location.origin}/api/auth/callback`
    const callbackUrl = inviteCode
      ? `${base}?inviteCode=${encodeURIComponent(inviteCode)}&handicap=${handicapVal ?? ''}&noHandicap=${noHcp ? '1' : '0'}`
      : base

    const { data, error: signUpErr } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: callbackUrl,
        data: {
          full_name:       name.trim(),
          handicap:        handicapVal !== null ? String(handicapVal) : '',
          handicap_status: handicapStatus,
        },
      },
    })

    setLoading(false)

    if (signUpErr) {
      const msg = signUpErr.message.toLowerCase()
      if (msg.includes('already registered') || msg.includes('already exists')) {
        setError('An account with this email already exists. Sign in instead.')
      } else {
        setError(signUpErr.message)
      }
      return
    }

    // Session created immediately (email confirmation disabled in Supabase)
    if (data.session && data.user) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db: any = supabase
      await db.from('profiles').upsert({
        id:              data.user.id,
        email:           email.trim(),
        full_name:       name.trim(),
        handicap:        handicapVal,
        handicap_status: handicapStatus,
      }, { onConflict: 'id' })

      // If player arrived via invite link, join the trip before redirecting
      if (inviteCode) {
        await fetch('/api/join', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ invite_code: inviteCode, playing_handicap: handicapVal }),
        })
        router.push(redirectTo)
      } else {
        router.push('/dashboard')
      }
      router.refresh()
    } else {
      // Email confirmation required — profile will be written by the trigger
      // which now reads handicap + handicap_status from raw_user_meta_data
      setStep('check_email')
    }
  }

  if (step === 'check_email') return (
    <>
      <p style={{ fontSize: 36, textAlign: 'center', marginBottom: 10 }}>📧</p>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: '#1a1a16', textAlign: 'center', marginBottom: 8 }}>
        Check your email
      </h1>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260', textAlign: 'center', marginBottom: 4 }}>
        We sent a confirmation link to <strong>{email}</strong>.
      </p>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260', textAlign: 'center' }}>
        Click it to activate your account and sign in.
      </p>
    </>
  )

  return (
    <>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: '#1a1a16', marginBottom: 4 }}>
        Create account
      </h1>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260', marginBottom: 20 }}>
        Run your golf event like a pro.
      </p>

      {errorMsg && (
        <div style={{
          marginBottom: 14, padding: '10px 14px', borderRadius: 10,
          background: '#fef2f2', border: '1.5px solid #fca5a5',
          fontFamily: 'var(--font-body)', fontSize: 13, color: '#b91c1c',
        }}>
          {errorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <FF label="Full name" required>
          <input type="text" required autoComplete="name" maxLength={80}
            value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            placeholder="James Smith" style={inp} />
        </FF>

        <FF label="Email address" required>
          <input type="email" required autoComplete="email"
            value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            placeholder="you@example.com" style={inp} />
        </FF>

        <FF label="Password" required hint="Minimum 8 characters">
          <input type="password" required autoComplete="new-password" minLength={8}
            value={password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPass(e.target.value)}
            placeholder="••••••••" style={inp} />
        </FF>

        <FF label="Confirm password" required>
          <input type="password" required autoComplete="new-password"
            value={confirm} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirm(e.target.value)}
            placeholder="••••••••" style={inp} />
        </FF>

        <FF label="Golf handicap" hint="Your default handicap for future trips and events.">
          {!noHcp && (
            <input type="number" min={-10} max={54} step={0.1}
              value={hcp} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHcp(e.target.value)}
              placeholder="e.g. 14 or 14.5" style={{ ...inp, marginBottom: 8 }} />
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={noHcp}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setNoHcp(e.target.checked)
                if (e.target.checked) setHcp('')
              }} />
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260' }}>
              I don&apos;t have an official handicap
            </span>
          </label>
        </FF>

        <button type="submit" disabled={loading} style={{
          width: '100%', padding: '13px 20px', borderRadius: 12,
          border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
          background: loading ? '#9db8a8' : 'linear-gradient(135deg, #2d7a52, #1a4731)',
          fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 700, color: '#ffffff',
          boxShadow: loading ? 'none' : '0 3px 12px rgba(26,71,49,0.35)',
        }}>
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260', textAlign: 'center', marginTop: 16 }}>
        Already have an account?{' '}
        <a href="/login" style={{ color: '#1a4731', fontWeight: 600, textDecoration: 'none' }}>Sign in</a>
      </p>
    </>
  )
}

function FF({ label, required, hint, children }: React.PropsWithChildren<{
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

const inp: React.CSSProperties = {
  width: '100%', borderRadius: 10, border: '1.5px solid #d9c9a3',
  padding: '11px 14px', fontSize: 14, fontFamily: 'var(--font-body)',
  color: '#1a1a16', background: '#ffffff', outline: 'none', boxSizing: 'border-box',
}
