'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type AuthMode = 'magic_link' | 'password'

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirectTo') || '/dashboard'

  const [mode, setMode] = useState<AuthMode>('magic_link')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const supabase = createClient()

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return

    setLoading(true)
    setMessage(null)

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback?redirectTo=${redirectTo}`,
      },
    })

    setLoading(false)

    if (error) {
      setMessage({ type: 'error', text: error.message })
    } else {
      setMessage({
        type: 'success',
        text: `Check your email — we've sent a sign-in link to ${email}`,
      })
    }
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !password) return

    setLoading(true)
    setMessage(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    setLoading(false)

    if (error) {
      setMessage({ type: 'error', text: error.message })
    } else {
      router.push(redirectTo)
      router.refresh()
    }
  }

  return (
    <>
      <h1 className="text-xl font-bold text-text mb-1">Sign in</h1>
      <p className="text-text-muted text-sm mb-6">
        {mode === 'magic_link'
          ? "We'll send you a sign-in link — no password needed."
          : 'Sign in with your email and password.'}
      </p>

      <form onSubmit={mode === 'magic_link' ? handleMagicLink : handlePassword}>
        <div className="space-y-3">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-text mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-surface-subtle px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent"
              placeholder="you@example.com"
            />
          </div>

          {mode === 'password' && (
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-text mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-surface-subtle px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent"
                placeholder="••••••••"
              />
            </div>
          )}

          {message && (
            <div
              className={`rounded-xl px-4 py-3 text-sm ${
                message.type === 'success'
                  ? 'bg-brand-50 text-brand-600'
                  : 'bg-red-50 text-red-600'
              }`}
            >
              {message.text}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading
              ? 'Sending...'
              : mode === 'magic_link'
              ? 'Send sign-in link'
              : 'Sign in'}
          </button>
        </div>
      </form>

      <div className="mt-4 text-center">
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'magic_link' ? 'password' : 'magic_link')
            setMessage(null)
          }}
          className="text-sm text-text-muted hover:text-brand-600 transition-colors"
        >
          {mode === 'magic_link'
            ? 'Sign in with password instead'
            : 'Sign in with a magic link instead'}
        </button>
      </div>
    </>
  )
}
