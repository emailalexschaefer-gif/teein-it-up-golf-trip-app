'use client'

import React from 'react'
import Link from 'next/link'
// Password reset flow — two screens:
//
// Screen 1 (no ?code in URL): enter email → sends reset link via Supabase.
//   The reset link goes through /api/auth/callback?next=/reset-password
//   which exchanges the PKCE code and establishes a session, then lands here.
//
// Screen 2 (arrived from reset email, session already active): set new password.
//   We detect "session active" via supabase.auth.getUser() on mount.
//   updateUser({ password }) works because the session is established.
//
// This works for:
//   • Forgotten password (existing password account)
//   • Magic-link-only accounts that want to add a password

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function ResetPasswordForm() {
  const router = useRouter()

  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [loading, setLoading]     = useState(false)
  const [msg, setMsg]             = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [screen, setScreen]       = useState<'loading' | 'request' | 'set'>('loading')

  const supabase = createClient()

  useEffect(() => {
    // If a session is already active, the user arrived from the reset email
    // (the callback route already exchanged the code). Show the "set password" form.
    supabase.auth.getUser().then(({ data: { user } }: { data: { user: { id: string } | null } }) => {
      if (user) {
        setScreen('set')
      } else {
        setScreen('request')
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Screen 1: request reset email ─────────────────────────────────────────

  async function handleSendReset(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setMsg(null)

    // Route through the PKCE callback so the code is exchanged server-side.
    // After exchange, the callback redirects to /reset-password (this page)
    // where getUser() will now return a user → shows the "set password" screen.
    const callbackUrl = `${window.location.origin}/api/auth/callback?next=/reset-password`

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: callbackUrl,
    })

    setLoading(false)

    if (error) {
      setMsg({ type: 'err', text: error.message })
    } else {
      setMsg({
        type: 'ok',
        text: `Reset link sent to ${email}. Check your inbox and tap the link.`,
      })
    }
  }

  // ── Screen 2: set new password ─────────────────────────────────────────────

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault()

    if (password !== confirm) {
      setMsg({ type: 'err', text: 'Passwords do not match.' })
      return
    }
    if (password.length < 8) {
      setMsg({ type: 'err', text: 'Password must be at least 8 characters.' })
      return
    }

    setLoading(true); setMsg(null)

    const { error } = await supabase.auth.updateUser({ password })

    setLoading(false)

    if (error) {
      setMsg({ type: 'err', text: error.message })
    } else {
      setMsg({ type: 'ok', text: 'Password set! Taking you to your dashboard…' })
      setTimeout(() => router.push('/dashboard'), 1500)
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  if (screen === 'loading') {
    return (
      <div className="flex justify-center py-10">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    )
  }

  // ── Screen 2: set password ─────────────────────────────────────────────────

  if (screen === 'set') {
    return (
      <>
        <h1 className="text-xl font-bold text-text mb-1">Set your password</h1>
        <p className="text-text-muted text-sm mb-6">
          Choose a password for your account. You can use it to sign in any time.
        </p>

        <form onSubmit={handleSetPassword} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-text mb-1">New password</label>
            <input
              type="password" required minLength={8} value={password}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
              placeholder="Minimum 8 characters"
              autoComplete="new-password"
              className="w-full rounded-xl border border-surface-subtle px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">Confirm password</label>
            <input
              type="password" required minLength={8} value={confirm}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirm(e.target.value)}
              placeholder="Repeat your password"
              autoComplete="new-password"
              className="w-full rounded-xl border border-surface-subtle px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </div>

          {msg && (
            <div className={`rounded-xl px-4 py-3 text-sm ${
              msg.type === 'ok' ? 'bg-brand-50 text-brand-600' : 'bg-red-50 text-red-600'
            }`}>{msg.text}</div>
          )}

          <button type="submit" disabled={loading}
            className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50">
            {loading ? 'Saving…' : 'Set password'}
          </button>
        </form>
      </>
    )
  }

  // ── Screen 1: request reset email ──────────────────────────────────────────

  return (
    <>
      <h1 className="text-xl font-bold text-text mb-1">Set or reset your password</h1>
      <p className="text-text-muted text-sm mb-6">
        Enter your email and we&apos;ll send a link. Works for forgotten passwords
        and for accounts created with a magic link.
      </p>

      <form onSubmit={handleSendReset} className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-text mb-1">Email</label>
          <input
            type="email" required value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className="w-full rounded-xl border border-surface-subtle px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
          />
        </div>

        {msg && (
          <div className={`rounded-xl px-4 py-3 text-sm ${
            msg.type === 'ok' ? 'bg-brand-50 text-brand-600' : 'bg-red-50 text-red-600'
          }`}>{msg.text}</div>
        )}

        <button type="submit" disabled={loading}
          className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50">
          {loading ? 'Sending…' : 'Send reset link'}
        </button>
      </form>

      <div className="mt-4 text-center">
        <Link href="/login" className="text-sm text-text-muted hover:text-brand-600 transition-colors">
          Back to sign in
        </Link>
      </div>
    </>
  )
}
