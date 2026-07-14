'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Step = 'form' | 'check_email' | 'error'

export default function SignupForm() {
  const router = useRouter()
  const supabase = createClient()

  const [name, setName]       = useState('')
  const [email, setEmail]     = useState('')
  const [password, setPass]   = useState('')
  const [hcp, setHcp]         = useState('')
  const [noHcp, setNoHcp]     = useState(false)
  const [step, setStep]       = useState<Step>('form')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setError]  = useState('')

  const handicapVal: number | null = noHcp
    ? null
    : hcp === '' ? null : parseFloat(hcp)

  function validate(): string | null {
    if (!name.trim())                         return 'Full name is required.'
    if (!email.trim())                         return 'Email is required.'
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email))  return 'Enter a valid email address.'
    if (password.length < 8)                   return 'Password must be at least 8 characters.'
    if (!noHcp && hcp !== '') {
      const n = parseFloat(hcp)
      if (isNaN(n) || n < -10 || n > 54)      return 'Handicap must be between -10 and 54.'
    }
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const err = validate()
    if (err) { setError(err); return }

    setLoading(true); setError('')

    const { data, error: signUpErr } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: name.trim(),
          handicap:  handicapVal !== null ? String(handicapVal) : '',
        },
      },
    })

    setLoading(false)

    if (signUpErr) {
      if (signUpErr.message.toLowerCase().includes('already registered') ||
          signUpErr.message.toLowerCase().includes('already exists')) {
        setError('An account with this email already exists. Sign in instead.')
      } else {
        setError(signUpErr.message)
      }
      return
    }

    // If session was created immediately (email confirmation disabled)
    if (data.session) {
      // Update profile with handicap — trigger fires but let's ensure it's right
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db: any = supabase
      await db.from('profiles').update({
        full_name: name.trim(),
        handicap:  handicapVal,
      }).eq('id', data.user?.id)

      router.push('/dashboard')
      router.refresh()
    } else {
      // Email confirmation required
      setStep('check_email')
    }
  }

  if (step === 'check_email') return (
    <>
      <p className="text-3xl text-center mb-3">📧</p>
      <h1 className="text-lg font-bold text-text text-center mb-2">Check your email</h1>
      <p className="text-text-muted text-sm text-center mb-1">
        We sent a confirmation link to <strong>{email}</strong>.
      </p>
      <p className="text-text-muted text-sm text-center">
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
        <FormField label="Full name" required>
          <input
            type="text" required autoComplete="name" maxLength={80}
            value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            placeholder="James Smith"
            style={inputSty}
          />
        </FormField>

        <FormField label="Email address" required>
          <input
            type="email" required autoComplete="email"
            value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={inputSty}
          />
        </FormField>

        <FormField label="Password" required hint="Minimum 8 characters">
          <input
            type="password" required autoComplete="new-password" minLength={8}
            value={password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPass(e.target.value)}
            placeholder="••••••••"
            style={inputSty}
          />
        </FormField>

        <FormField label="Golf handicap" hint="Your default handicap for future trips and events.">
          {!noHcp && (
            <input
              type="number" min={-10} max={54} step={0.1}
              value={hcp} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHcp(e.target.value)}
              placeholder="e.g. 14 or 14.5"
              style={{ ...inputSty, marginBottom: 8 }}
            />
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox" checked={noHcp}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setNoHcp(e.target.checked)
                if (e.target.checked) setHcp('')
              }}
            />
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260' }}>
              I don&apos;t have an official handicap
            </span>
          </label>
        </FormField>

        <button
          type="submit" disabled={loading}
          style={{
            width: '100%', padding: '13px 20px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: loading ? '#9db8a8' : 'linear-gradient(135deg, #2d7a52, #1a4731)',
            fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 700, color: '#ffffff',
            boxShadow: loading ? 'none' : '0 3px 12px rgba(26,71,49,0.35)',
          }}
        >
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

function FormField({ label, required, hint, children }: React.PropsWithChildren<{
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
      {hint && (
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#a89e88', marginBottom: 5 }}>{hint}</p>
      )}
      {children}
    </div>
  )
}

const inputSty: React.CSSProperties = {
  width: '100%', borderRadius: 10, border: '1.5px solid #d9c9a3',
  padding: '11px 14px', fontSize: 14, fontFamily: 'var(--font-body)',
  color: '#1a1a16', background: '#ffffff', outline: 'none', boxSizing: 'border-box',
}
